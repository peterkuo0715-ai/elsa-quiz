import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
  PayoutRequestStatus,
} from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerService } from "./ledger.service";
import { money, moneyCompare, moneyToString, ZERO } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { PAYOUT_BLACKOUT_START_HOUR, PAYOUT_BLACKOUT_END_HOUR } from "@/lib/constants";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * PayoutService - Handles merchant payout requests and batch processing.
 */
export const PayoutService = {
  /**
   * Validate if a payout request can be made.
   */
  validatePayoutRequest(params: {
    currentHour: number;
    availableBalance: string | number;
    requestedAmount: string | number;
    isFrozen: boolean;
    payoutSuspended: boolean;
  }): { valid: boolean; reason?: string } {
    const { currentHour, availableBalance, requestedAmount, isFrozen, payoutSuspended } = params;

    // Check blackout window
    if (currentHour >= PAYOUT_BLACKOUT_START_HOUR && currentHour < PAYOUT_BLACKOUT_END_HOUR) {
      return { valid: false, reason: `每日 ${PAYOUT_BLACKOUT_START_HOUR}:00 ~ ${PAYOUT_BLACKOUT_END_HOUR}:00 禁止提領申請` };
    }

    // Check wallet frozen
    if (isFrozen) {
      return { valid: false, reason: "錢包已被凍結，無法提領" };
    }

    // Check payout suspended (negative balance)
    if (payoutSuspended) {
      return { valid: false, reason: "因負餘額已暫停提領，請等待餘額回正" };
    }

    // Check sufficient balance
    const available = money(availableBalance);
    const requested = money(requestedAmount);
    if (moneyCompare(requested, available) > 0) {
      return { valid: false, reason: `可提領餘額不足。可提領: ${available.toString()}, 申請: ${requested.toString()}` };
    }

    if (moneyCompare(requested, ZERO) <= 0) {
      return { valid: false, reason: "提領金額必須大於 0" };
    }

    return { valid: true };
  },

  /**
   * Create a payout request.
   */
  async createRequest(
    prisma: PrismaClient,
    params: {
      merchantId: string;
      bankAccountId: string;
      amountTaxIncl: string;
      requestedBy?: string;
    }
  ) {
    const amount = money(params.amountTaxIncl);
    const breakdown = taxInclToBreakdown(amount);
    const now = new Date();
    const requestNumber = `PAY-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    // Get bank account snapshot
    const bankAccount = await prisma.merchantBankAccount.findUniqueOrThrow({
      where: { id: params.bankAccountId },
    });

    // Get wallet
    const wallet = await prisma.merchantWallet.findUniqueOrThrow({
      where: { merchantId: params.merchantId },
    });

    // Create payout request
    const payoutRequest = await prisma.payoutRequest.create({
      data: {
        requestNumber,
        merchantId: params.merchantId,
        bankAccountId: params.bankAccountId,
        amountTaxIncl: moneyToString(breakdown.taxIncl),
        amountTaxExcl: moneyToString(breakdown.taxExcl),
        taxAmount: moneyToString(breakdown.taxAmount),
        status: PayoutRequestStatus.REQUESTED,
        bankCodeSnapshot: bankAccount.bankCode,
        bankNameSnapshot: bankAccount.bankName,
        branchCodeSnapshot: bankAccount.branchCode,
        accountNumberSnapshot: bankAccount.accountNumber,
        accountNameSnapshot: bankAccount.accountName,
        requestedBy: params.requestedBy,
        requestedAt: now,
      },
    });

    // Create ledger entry: AVAILABLE -> IN_TRANSIT
    const tx = prisma as unknown as TxClient;
    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.PAYOUT_REQUESTED,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.PAYOUT_REQUEST,
      referenceId: payoutRequest.id,
      idempotencyKey: `payout-reserve-avail-${payoutRequest.id}`,
      description: "提領申請，款項轉至提領中",
    });

    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.IN_TRANSIT,
      entryType: LedgerEntryType.PAYOUT_REQUESTED,
      amount: breakdown.taxIncl,
      amountTaxIncl: breakdown.taxIncl,
      amountTaxExcl: breakdown.taxExcl,
      taxAmount: breakdown.taxAmount,
      referenceType: ReferenceType.PAYOUT_REQUEST,
      referenceId: payoutRequest.id,
      idempotencyKey: `payout-reserve-transit-${payoutRequest.id}`,
      description: "提領申請，款項入提領中",
    });

    return payoutRequest;
  },

  /**
   * Handle payout success - deduct from IN_TRANSIT.
   */
  async handleSuccess(prisma: PrismaClient, payoutRequestId: string) {
    const request = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: payoutRequestId },
      include: { merchant: { include: { wallet: true } } },
    });

    const wallet = request.merchant.wallet;
    if (!wallet) throw new Error("No wallet found");

    const amount = money(request.amountTaxIncl.toString());
    const breakdown = taxInclToBreakdown(amount);
    const tx = prisma as unknown as TxClient;

    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.IN_TRANSIT,
      entryType: LedgerEntryType.PAYOUT_SENT,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.PAYOUT_REQUEST,
      referenceId: payoutRequestId,
      idempotencyKey: `payout-complete-${payoutRequestId}`,
      description: "提領成功，款項已匯出",
    });

    await prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data: {
        status: PayoutRequestStatus.SUCCESS,
        completedAt: new Date(),
      },
    });
  },

  /**
   * Handle payout failure - return funds from IN_TRANSIT to AVAILABLE.
   */
  async handleFailure(
    prisma: PrismaClient,
    payoutRequestId: string,
    failureReason: string,
    bankErrorCode?: string
  ) {
    const request = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: payoutRequestId },
      include: { merchant: { include: { wallet: true } } },
    });

    const wallet = request.merchant.wallet;
    if (!wallet) throw new Error("No wallet found");

    const amount = money(request.amountTaxIncl.toString());
    const breakdown = taxInclToBreakdown(amount);
    const tx = prisma as unknown as TxClient;

    // Return from IN_TRANSIT
    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.IN_TRANSIT,
      entryType: LedgerEntryType.PAYOUT_FAILED_RETURN,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.PAYOUT_REQUEST,
      referenceId: payoutRequestId,
      idempotencyKey: `payout-fail-transit-${payoutRequestId}`,
      description: `提領失敗退回: ${failureReason}`,
    });

    // Add back to AVAILABLE
    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.PAYOUT_FAILED_RETURN,
      amount: breakdown.taxIncl,
      amountTaxIncl: breakdown.taxIncl,
      amountTaxExcl: breakdown.taxExcl,
      taxAmount: breakdown.taxAmount,
      referenceType: ReferenceType.PAYOUT_REQUEST,
      referenceId: payoutRequestId,
      idempotencyKey: `payout-fail-avail-${payoutRequestId}`,
      description: `提領失敗，款項退回可用餘額`,
    });

    // Update request status
    await prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data: {
        status: PayoutRequestStatus.FAILED,
        failedAt: new Date(),
      },
    });

    // Create failure record
    await prisma.payoutFailure.create({
      data: {
        payoutRequestId,
        failureReason,
        bankErrorCode,
      },
    });
  },
};

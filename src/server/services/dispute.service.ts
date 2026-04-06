import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
  DisputeStatus,
} from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerService } from "./ledger.service";
import { money, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * DisputeService - Handles dispute case management.
 *
 * KEY RULE: Only freeze the DISPUTED AMOUNT, never the entire order.
 */
export const DisputeService = {
  /**
   * Freeze the disputed amount.
   * Moves funds from AVAILABLE to RESERVED.
   */
  async freezeAmount(
    prisma: PrismaClient,
    params: {
      disputeId: string;
      walletId: string;
      amountTaxIncl: string;
    }
  ) {
    const tx = prisma as unknown as TxClient;
    const amount = money(params.amountTaxIncl);
    const breakdown = taxInclToBreakdown(amount);

    // Debit from AVAILABLE
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.DISPUTE_FREEZE_HOLD,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.DISPUTE_CASE,
      referenceId: params.disputeId,
      idempotencyKey: `dispute-freeze-avail-${params.disputeId}`,
      description: "爭議金額凍結（僅凍結爭議金額）",
    });

    // Credit to RESERVED
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.RESERVED,
      entryType: LedgerEntryType.DISPUTE_FREEZE_HOLD,
      amount: breakdown.taxIncl,
      amountTaxIncl: breakdown.taxIncl,
      amountTaxExcl: breakdown.taxExcl,
      taxAmount: breakdown.taxAmount,
      referenceType: ReferenceType.DISPUTE_CASE,
      referenceId: params.disputeId,
      idempotencyKey: `dispute-freeze-reserved-${params.disputeId}`,
      description: "爭議金額凍結至保留",
    });

    // Create freeze record
    await prisma.disputeFreeze.create({
      data: {
        disputeId: params.disputeId,
        walletId: params.walletId,
        frozenAmount: moneyToString(breakdown.taxIncl),
        isFrozen: true,
      },
    });
  },

  /**
   * Unfreeze disputed amount (merchant wins dispute).
   * Moves funds from RESERVED back to AVAILABLE.
   */
  async unfreezeAmount(
    prisma: PrismaClient,
    params: {
      disputeId: string;
      walletId: string;
    }
  ) {
    const tx = prisma as unknown as TxClient;
    const freeze = await prisma.disputeFreeze.findFirst({
      where: { disputeId: params.disputeId, isFrozen: true },
    });
    if (!freeze) throw new Error("No active freeze found");

    const amount = money(freeze.frozenAmount.toString());
    const breakdown = taxInclToBreakdown(amount);

    // Debit from RESERVED
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.RESERVED,
      entryType: LedgerEntryType.DISPUTE_FREEZE_RELEASE,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.DISPUTE_CASE,
      referenceId: params.disputeId,
      idempotencyKey: `dispute-unfreeze-reserved-${params.disputeId}`,
      description: "爭議解除，釋放保留金",
    });

    // Credit to AVAILABLE
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.DISPUTE_FREEZE_RELEASE,
      amount: breakdown.taxIncl,
      amountTaxIncl: breakdown.taxIncl,
      amountTaxExcl: breakdown.taxExcl,
      taxAmount: breakdown.taxAmount,
      referenceType: ReferenceType.DISPUTE_CASE,
      referenceId: params.disputeId,
      idempotencyKey: `dispute-unfreeze-avail-${params.disputeId}`,
      description: "爭議解除，款項回到可用",
    });

    // Update freeze record
    await prisma.disputeFreeze.update({
      where: { id: freeze.id },
      data: { isFrozen: false, unfrozenAt: new Date(), unfrozenReason: "爭議解除" },
    });
  },

  /**
   * Debit disputed amount (merchant loses dispute).
   * Removes funds from RESERVED permanently.
   */
  async debitDisputedAmount(
    prisma: PrismaClient,
    params: {
      disputeId: string;
      walletId: string;
    }
  ) {
    const tx = prisma as unknown as TxClient;
    const freeze = await prisma.disputeFreeze.findFirst({
      where: { disputeId: params.disputeId, isFrozen: true },
    });
    if (!freeze) throw new Error("No active freeze found");

    const amount = money(freeze.frozenAmount.toString());
    const breakdown = taxInclToBreakdown(amount);

    // Debit from RESERVED (permanent removal)
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.RESERVED,
      entryType: LedgerEntryType.DISPUTE_DEBIT,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.DISPUTE_CASE,
      referenceId: params.disputeId,
      idempotencyKey: `dispute-debit-${params.disputeId}`,
      description: "爭議判定扣回",
    });

    // Update freeze record
    await prisma.disputeFreeze.update({
      where: { id: freeze.id },
      data: { isFrozen: false, unfrozenAt: new Date(), unfrozenReason: "爭議判定扣回" },
    });
  },
};

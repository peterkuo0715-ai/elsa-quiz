import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
} from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerService } from "./ledger.service";
import { money, moneyMul, moneyDiv, moneySub, moneyRound, moneyCeil, moneyToString, moneyIsNegative, ZERO } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * RefundService - Handles refund processing with proportional calculations.
 *
 * Rules:
 * - Platform commission: refunded proportionally
 * - Payment processing fee: NOT refunded
 * - Campaign cost: recovered proportionally
 * - Post-withdrawal refund: creates negative balance, suspends payout
 */
export const RefundService = {
  /**
   * Calculate refund breakdown for an order item.
   */
  calculateRefundBreakdown(params: {
    refundAmountTaxIncl: string | number;
    originalItemAmountTaxIncl: string | number;
    originalCommission: string | number;
    campaignDiscount: string | number;
  }) {
    const refundAmount = money(params.refundAmountTaxIncl);
    const originalAmount = money(params.originalItemAmountTaxIncl);
    const originalCommission = money(params.originalCommission);
    const campaignDiscount = money(params.campaignDiscount);

    // Proportional ratio
    const ratio = originalAmount.isZero()
      ? ZERO
      : moneyDiv(refundAmount, originalAmount);

    // Commission refund (proportional) - platform returns this to merchant
    // Use ceiling to match original commission calculation
    const commissionRefund = moneyCeil(moneyMul(originalCommission, ratio));

    // Campaign cost recovery (proportional) - merchant returns this to platform
    const campaignCostRecovery = moneyRound(moneyMul(campaignDiscount, ratio));

    // Payment fee: NOT refunded (always 0)
    const paymentFeeRefund = ZERO;

    // Net debit to merchant = refundAmount - commissionRefund + campaignCostRecovery
    const netMerchantDebit = moneyRound(
      moneySub(refundAmount, commissionRefund).plus(campaignCostRecovery)
    );

    return {
      refundAmount,
      commissionRefund,
      paymentFeeRefund,
      campaignCostRecovery,
      netMerchantDebit,
    };
  },

  /**
   * Process a refund for a single refund item.
   * Creates ledger entries and checks for negative balance.
   */
  async processRefundItem(
    prisma: PrismaClient,
    params: {
      walletId: string;
      refundItemId: string;
      netMerchantDebit: string;
      commissionRefund: string;
      campaignCostRecovery: string;
    }
  ) {
    const tx = prisma as unknown as TxClient;
    const netDebit = money(params.netMerchantDebit);
    const netBreakdown = taxInclToBreakdown(netDebit);

    // 1. REFUND_DEBIT from AVAILABLE
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.REFUND_DEBIT,
      amount: netBreakdown.taxIncl.negated(),
      amountTaxIncl: netBreakdown.taxIncl.negated(),
      amountTaxExcl: netBreakdown.taxExcl.negated(),
      taxAmount: netBreakdown.taxAmount.negated(),
      referenceType: ReferenceType.REFUND_ITEM,
      referenceId: params.refundItemId,
      idempotencyKey: `refund-debit-${params.refundItemId}`,
      description: "退款扣回",
    });

    // 2. If commission refund > 0, REFUND_COMMISSION_RETURN (credit back to merchant)
    const commRefund = money(params.commissionRefund);
    if (!commRefund.isZero()) {
      const commBreakdown = taxInclToBreakdown(commRefund);
      await LedgerService.createEntry(tx, {
        walletId: params.walletId,
        bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.REFUND_COMMISSION_RETURN,
        amount: commBreakdown.taxIncl,
        amountTaxIncl: commBreakdown.taxIncl,
        amountTaxExcl: commBreakdown.taxExcl,
        taxAmount: commBreakdown.taxAmount,
        referenceType: ReferenceType.REFUND_ITEM,
        referenceId: params.refundItemId,
        idempotencyKey: `refund-comm-return-${params.refundItemId}`,
        description: "退款抽成返還",
      });
    }

    // 3. If campaign cost recovery > 0, REFUND_CAMPAIGN_RECOVERY (debit from merchant)
    const campRecovery = money(params.campaignCostRecovery);
    if (!campRecovery.isZero()) {
      const campBreakdown = taxInclToBreakdown(campRecovery);
      await LedgerService.createEntry(tx, {
        walletId: params.walletId,
        bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.REFUND_CAMPAIGN_RECOVERY,
        amount: campBreakdown.taxIncl.negated(),
        amountTaxIncl: campBreakdown.taxIncl.negated(),
        amountTaxExcl: campBreakdown.taxExcl.negated(),
        taxAmount: campBreakdown.taxAmount.negated(),
        referenceType: ReferenceType.REFUND_ITEM,
        referenceId: params.refundItemId,
        idempotencyKey: `refund-camp-recovery-${params.refundItemId}`,
        description: "活動成本回收",
      });
    }

    // 4. Check for negative balance and suspend payout if needed
    const balances = await LedgerService.getBalances(tx, params.walletId);
    if (moneyIsNegative(balances.available)) {
      await prisma.merchantWallet.update({
        where: { id: params.walletId },
        data: { payoutSuspended: true },
      });
    }
  },
};

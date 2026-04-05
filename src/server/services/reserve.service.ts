import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
} from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerService } from "./ledger.service";
import { money } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * ReserveService - Manages risk-level based reserves.
 *
 * Reserves are held amounts from AVAILABLE that cannot be withdrawn.
 * They are released after a hold period or manually by finance.
 */
export const ReserveService = {
  /**
   * Release reserve back to AVAILABLE.
   */
  async releaseReserve(
    prisma: PrismaClient,
    params: {
      walletId: string;
      amountTaxIncl: string;
      reserveRuleId: string;
      reason?: string;
    }
  ) {
    const tx = prisma as unknown as TxClient;
    const amount = money(params.amountTaxIncl);
    const breakdown = taxInclToBreakdown(amount);

    // Debit from RESERVED
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.RESERVED,
      entryType: LedgerEntryType.RESERVE_RELEASE,
      amount: breakdown.taxIncl.negated(),
      amountTaxIncl: breakdown.taxIncl.negated(),
      amountTaxExcl: breakdown.taxExcl.negated(),
      taxAmount: breakdown.taxAmount.negated(),
      referenceType: ReferenceType.RESERVE_RULE,
      referenceId: params.reserveRuleId,
      idempotencyKey: `reserve-release-reserved-${params.reserveRuleId}-${Date.now()}`,
      description: params.reason || "保留金釋放",
    });

    // Credit to AVAILABLE
    await LedgerService.createEntry(tx, {
      walletId: params.walletId,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.RESERVE_RELEASE,
      amount: breakdown.taxIncl,
      amountTaxIncl: breakdown.taxIncl,
      amountTaxExcl: breakdown.taxExcl,
      taxAmount: breakdown.taxAmount,
      referenceType: ReferenceType.RESERVE_RULE,
      referenceId: params.reserveRuleId,
      idempotencyKey: `reserve-release-avail-${params.reserveRuleId}-${Date.now()}`,
      description: params.reason || "保留金釋放至可用",
    });
  },
};

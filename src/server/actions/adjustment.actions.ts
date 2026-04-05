"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { LedgerService } from "@/server/services/ledger.service";
import { AuditService } from "@/server/services/audit.service";
import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
  AdjustmentType,
} from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";

export async function createAdjustment(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  const merchantId = formData.get("merchantId") as string;
  const adjustmentType = formData.get("adjustmentType") as AdjustmentType;
  const amountStr = formData.get("amount") as string;
  const isCredit = formData.get("direction") === "credit";
  const reason = formData.get("reason") as string;

  if (!merchantId || !adjustmentType || !amountStr || !reason) {
    return { error: "請填寫完整資訊" };
  }

  try {
    const wallet = await prisma.merchantWallet.findUnique({
      where: { merchantId },
    });
    if (!wallet) return { error: "商家錢包不存在" };

    const amount = money(amountStr);
    const breakdown = taxInclToBreakdown(amount);

    // Create adjustment record
    const adjustment = await prisma.settlementAdjustment.create({
      data: {
        merchantId,
        adjustmentType,
        amountTaxIncl: moneyToString(isCredit ? breakdown.taxIncl : breakdown.taxIncl.negated()),
        amountTaxExcl: moneyToString(isCredit ? breakdown.taxExcl : breakdown.taxExcl.negated()),
        taxAmount: moneyToString(isCredit ? breakdown.taxAmount : breakdown.taxAmount.negated()),
        reason,
        createdBy: session.user.id,
      },
    });

    // Create ledger entry
    const tx = prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
    const entryType = isCredit
      ? LedgerEntryType.MANUAL_ADJUSTMENT_CREDIT
      : LedgerEntryType.MANUAL_ADJUSTMENT_DEBIT;

    const ledgerAmount = isCredit ? breakdown.taxIncl : breakdown.taxIncl.negated();

    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.AVAILABLE,
      entryType,
      amount: ledgerAmount,
      amountTaxIncl: isCredit ? breakdown.taxIncl : breakdown.taxIncl.negated(),
      amountTaxExcl: isCredit ? breakdown.taxExcl : breakdown.taxExcl.negated(),
      taxAmount: isCredit ? breakdown.taxAmount : breakdown.taxAmount.negated(),
      referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT,
      referenceId: adjustment.id,
      idempotencyKey: `adjustment-${adjustment.id}`,
      description: `手動調整: ${reason}`,
    });

    await AuditService.log(tx, {
      userId: session.user.id,
      action: "adjustment.create",
      entityType: "SettlementAdjustment",
      entityId: adjustment.id,
      newValue: {
        adjustmentType,
        direction: isCredit ? "credit" : "debit",
        amount: amountStr,
        reason,
      },
    });

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "調整失敗" };
  }
}

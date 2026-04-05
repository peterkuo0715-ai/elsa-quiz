"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { AuditService } from "@/server/services/audit.service";
import { LedgerService } from "@/server/services/ledger.service";
import { PayoutService } from "@/server/services/payout.service";
import {
  SettlementItemStatus,
  PayoutRequestStatus,
  DisputeStatus,
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
} from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import type { PrismaClient } from "@/generated/prisma";

/**
 * Force override a settlement item status (SUPER_ADMIN only).
 */
export async function overrideSettlementStatus(
  settlementItemId: string,
  newStatus: SettlementItemStatus,
  reason: string
) {
  const session = await auth();
  if (!session?.user?.roles?.includes("SUPER_ADMIN")) {
    return { error: "權限不足" };
  }

  try {
    const item = await prisma.settlementItem.findUnique({
      where: { id: settlementItemId },
    });
    if (!item) return { error: "結算項目不存在" };

    const oldStatus = item.status;

    await prisma.settlementItem.update({
      where: { id: settlementItemId },
      data: { status: newStatus },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "admin.override_settlement_status",
      entityType: "SettlementItem",
      entityId: settlementItemId,
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      reason,
    });

    return { success: true };
  } catch (error) {
    return { error: "覆寫失敗" };
  }
}

/**
 * Force override a payout request status (SUPER_ADMIN only).
 */
export async function overridePayoutStatus(
  payoutRequestId: string,
  newStatus: PayoutRequestStatus,
  reason: string
) {
  const session = await auth();
  if (!session?.user?.roles?.includes("SUPER_ADMIN")) {
    return { error: "權限不足" };
  }

  try {
    const request = await prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
    });
    if (!request) return { error: "提領申請不存在" };

    const oldStatus = request.status;

    // If forcing to FAILED, handle wallet return
    if (newStatus === PayoutRequestStatus.FAILED && oldStatus === PayoutRequestStatus.PROCESSING) {
      await PayoutService.handleFailure(
        prisma as unknown as PrismaClient,
        payoutRequestId,
        `管理員強制標記失敗: ${reason}`
      );
    } else {
      await prisma.payoutRequest.update({
        where: { id: payoutRequestId },
        data: { status: newStatus },
      });
    }

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "admin.override_payout_status",
      entityType: "PayoutRequest",
      entityId: payoutRequestId,
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      reason,
    });

    return { success: true };
  } catch (error) {
    return { error: "覆寫失敗" };
  }
}

/**
 * Freeze / unfreeze a merchant wallet (SUPER_ADMIN only).
 */
export async function toggleWalletFreeze(
  merchantId: string,
  freeze: boolean,
  reason: string
) {
  const session = await auth();
  if (!session?.user?.roles?.includes("SUPER_ADMIN")) {
    return { error: "權限不足" };
  }

  try {
    const wallet = await prisma.merchantWallet.findUnique({
      where: { merchantId },
    });
    if (!wallet) return { error: "錢包不存在" };

    await prisma.merchantWallet.update({
      where: { merchantId },
      data: {
        isFrozen: freeze,
        frozenReason: freeze ? reason : null,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: freeze ? "admin.freeze_wallet" : "admin.unfreeze_wallet",
      entityType: "MerchantWallet",
      entityId: wallet.id,
      oldValue: { isFrozen: wallet.isFrozen },
      newValue: { isFrozen: freeze },
      reason,
    });

    return { success: true };
  } catch (error) {
    return { error: "操作失敗" };
  }
}

/**
 * Force create an adjustment (SUPER_ADMIN only, bypasses normal flow).
 */
export async function forceAdjustment(
  merchantId: string,
  amountTaxIncl: string,
  isCredit: boolean,
  reason: string
) {
  const session = await auth();
  if (!session?.user?.roles?.includes("SUPER_ADMIN")) {
    return { error: "權限不足" };
  }

  try {
    const wallet = await prisma.merchantWallet.findUnique({
      where: { merchantId },
    });
    if (!wallet) return { error: "錢包不存在" };

    const amount = money(amountTaxIncl);
    const breakdown = taxInclToBreakdown(amount);
    const entryType = isCredit
      ? LedgerEntryType.MANUAL_ADJUSTMENT_CREDIT
      : LedgerEntryType.MANUAL_ADJUSTMENT_DEBIT;
    const ledgerAmount = isCredit ? breakdown.taxIncl : breakdown.taxIncl.negated();

    const tx = prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
    await LedgerService.createEntry(tx, {
      walletId: wallet.id,
      bucket: WalletBucket.AVAILABLE,
      entryType,
      amount: ledgerAmount,
      amountTaxIncl: isCredit ? breakdown.taxIncl : breakdown.taxIncl.negated(),
      amountTaxExcl: isCredit ? breakdown.taxExcl : breakdown.taxExcl.negated(),
      taxAmount: isCredit ? breakdown.taxAmount : breakdown.taxAmount.negated(),
      referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT,
      referenceId: `admin-force-${Date.now()}`,
      idempotencyKey: `admin-force-adj-${merchantId}-${Date.now()}`,
      description: `管理員強制調整: ${reason}`,
    });

    await AuditService.log(tx, {
      userId: session.user.id,
      action: "admin.force_adjustment",
      entityType: "MerchantWallet",
      entityId: wallet.id,
      newValue: { amount: amountTaxIncl, isCredit, reason },
      reason,
    });

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作失敗" };
  }
}

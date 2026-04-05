"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { DisputeService } from "@/server/services/dispute.service";
import { AuditService } from "@/server/services/audit.service";
import { DisputeStatus } from "@/generated/prisma";
import { moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import type { PrismaClient } from "@/generated/prisma";

/**
 * Create a new dispute case.
 */
export async function createDisputeCase(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  const merchantId = formData.get("merchantId") as string;
  const orderId = formData.get("orderId") as string;
  const orderItemId = formData.get("orderItemId") as string;
  const disputeReason = formData.get("disputeReason") as string;
  const disputeAmountTaxIncl = formData.get("disputeAmountTaxIncl") as string;

  if (!merchantId || !disputeReason || !disputeAmountTaxIncl) {
    return { error: "請填寫完整資訊" };
  }

  try {
    const now = new Date();
    const caseNumber = `DSP-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;
    const breakdown = taxInclToBreakdown(disputeAmountTaxIncl);

    const disputeCase = await prisma.disputeCase.create({
      data: {
        caseNumber,
        merchantId,
        orderId: orderId || null,
        orderItemId: orderItemId || null,
        status: DisputeStatus.OPENED,
        disputeReason,
        disputeAmountTaxIncl: moneyToString(breakdown.taxIncl),
        disputeAmountTaxExcl: moneyToString(breakdown.taxExcl),
        disputeTaxAmount: moneyToString(breakdown.taxAmount),
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "dispute.create",
      entityType: "DisputeCase",
      entityId: disputeCase.id,
      newValue: { caseNumber, disputeReason, amount: disputeAmountTaxIncl },
    });

    return { success: true, caseNumber };
  } catch (error) {
    return { error: "建立爭議案件失敗" };
  }
}

/**
 * Freeze disputed amount (platform action).
 * KEY RULE: Only freeze the disputed amount, NOT the entire order.
 */
export async function freezeDisputeAmount(disputeId: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });

    if (!dispute) return { error: "案件不存在" };
    if (!dispute.merchant.wallet) return { error: "商家錢包不存在" };

    await DisputeService.freezeAmount(
      prisma as unknown as PrismaClient,
      {
        disputeId,
        walletId: dispute.merchant.wallet.id,
        amountTaxIncl: dispute.disputeAmountTaxIncl.toString(),
      }
    );

    await prisma.disputeCase.update({
      where: { id: disputeId },
      data: { status: DisputeStatus.PARTIALLY_FROZEN },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "dispute.freeze",
      entityType: "DisputeCase",
      entityId: disputeId,
      newValue: { frozenAmount: dispute.disputeAmountTaxIncl.toString() },
    });

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "凍結失敗" };
  }
}

/**
 * Resolve dispute (merchant wins - unfreeze).
 */
export async function resolveDispute(disputeId: string, resolution: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });

    if (!dispute) return { error: "案件不存在" };
    if (!dispute.merchant.wallet) return { error: "商家錢包不存在" };

    // Unfreeze if frozen
    const hasFrozen = await prisma.disputeFreeze.findFirst({
      where: { disputeId, isFrozen: true },
    });

    if (hasFrozen) {
      await DisputeService.unfreezeAmount(
        prisma as unknown as PrismaClient,
        { disputeId, walletId: dispute.merchant.wallet.id }
      );
    }

    await prisma.disputeCase.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.RESOLVED,
        resolution,
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "dispute.resolve",
      entityType: "DisputeCase",
      entityId: disputeId,
      newValue: { resolution, status: "RESOLVED" },
    });

    return { success: true };
  } catch (error) {
    return { error: "解決爭議失敗" };
  }
}

/**
 * Reject dispute (merchant loses - debit frozen amount).
 */
export async function rejectDispute(disputeId: string, resolution: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });

    if (!dispute) return { error: "案件不存在" };
    if (!dispute.merchant.wallet) return { error: "商家錢包不存在" };

    const hasFrozen = await prisma.disputeFreeze.findFirst({
      where: { disputeId, isFrozen: true },
    });

    if (hasFrozen) {
      await DisputeService.debitDisputedAmount(
        prisma as unknown as PrismaClient,
        { disputeId, walletId: dispute.merchant.wallet.id }
      );
    }

    await prisma.disputeCase.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.REJECTED,
        resolution,
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "dispute.reject",
      entityType: "DisputeCase",
      entityId: disputeId,
      newValue: { resolution, status: "REJECTED" },
    });

    return { success: true };
  } catch (error) {
    return { error: "駁回爭議失敗" };
  }
}

/**
 * Submit evidence for a dispute (merchant action).
 */
export async function submitDisputeEvidence(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  const disputeId = formData.get("disputeId") as string;
  const description = formData.get("description") as string;

  if (!disputeId || !description) return { error: "請填寫說明" };

  try {
    await prisma.disputeEvidence.create({
      data: {
        disputeId,
        submittedBy: session.user.id,
        description,
      },
    });

    // Update status if waiting for merchant
    await prisma.disputeCase.updateMany({
      where: {
        id: disputeId,
        status: DisputeStatus.WAITING_MERCHANT_RESPONSE,
      },
      data: { status: DisputeStatus.WAITING_PLATFORM_REVIEW },
    });

    return { success: true };
  } catch (error) {
    return { error: "補件失敗" };
  }
}

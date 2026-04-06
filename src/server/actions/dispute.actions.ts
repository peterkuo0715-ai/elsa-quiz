"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { DisputeService } from "@/server/services/dispute.service";
import { DisputeStatus } from "@/generated/prisma";
import { moneyToString, money } from "@/lib/money";
import type { PrismaClient } from "@/generated/prisma";

export async function freezeDisputeAmount(disputeId: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };
  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });
    if (!dispute || !dispute.merchant.wallet) return { error: "案件不存在" };
    await DisputeService.freezeAmount(prisma as unknown as PrismaClient, {
      disputeId, walletId: dispute.merchant.wallet.id, amountTaxIncl: dispute.disputeAmount.toString(),
    });
    await prisma.disputeCase.update({ where: { id: disputeId }, data: { status: DisputeStatus.PARTIALLY_FROZEN } });
    return { success: true };
  } catch (error) { return { error: "凍結失敗" }; }
}

export async function resolveDispute(disputeId: string, resolution: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };
  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });
    if (!dispute || !dispute.merchant.wallet) return { error: "案件不存在" };
    const hasFrozen = await prisma.disputeFreeze.findFirst({ where: { disputeId, isFrozen: true } });
    if (hasFrozen) await DisputeService.unfreezeAmount(prisma as unknown as PrismaClient, { disputeId, walletId: dispute.merchant.wallet.id });
    await prisma.disputeCase.update({ where: { id: disputeId }, data: { status: DisputeStatus.RESOLVED, resolution, resolvedAt: new Date(), resolvedBy: session.user.id } });
    return { success: true };
  } catch (error) { return { error: "操作失敗" }; }
}

export async function rejectDispute(disputeId: string, resolution: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };
  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { merchant: { include: { wallet: true } } },
    });
    if (!dispute || !dispute.merchant.wallet) return { error: "案件不存在" };
    const hasFrozen = await prisma.disputeFreeze.findFirst({ where: { disputeId, isFrozen: true } });
    if (hasFrozen) await DisputeService.debitDisputedAmount(prisma as unknown as PrismaClient, { disputeId, walletId: dispute.merchant.wallet.id });
    await prisma.disputeCase.update({ where: { id: disputeId }, data: { status: DisputeStatus.REJECTED, resolution, resolvedAt: new Date(), resolvedBy: session.user.id } });
    return { success: true };
  } catch (error) { return { error: "操作失敗" }; }
}

export async function submitDisputeEvidence(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };
  const disputeId = formData.get("disputeId") as string;
  const description = formData.get("description") as string;
  if (!disputeId || !description) return { error: "請填寫說明" };
  try {
    await prisma.disputeEvidence.create({ data: { disputeId, submittedBy: session.user.id, description } });
    return { success: true };
  } catch (error) { return { error: "補件失敗" }; }
}

"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { ReserveService } from "@/server/services/reserve.service";
import { AuditService } from "@/server/services/audit.service";
import { MerchantRiskLevel } from "@/generated/prisma";
import { moneyToString, money } from "@/lib/money";
import type { PrismaClient } from "@/generated/prisma";

export async function setMerchantRiskLevel(
  merchantId: string,
  riskLevel: MerchantRiskLevel,
  notes?: string
) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const profile = await prisma.merchantRiskProfile.upsert({
      where: { merchantId },
      update: { riskLevel, notes, setBy: session.user.id },
      create: { merchantId, riskLevel, notes, setBy: session.user.id },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "reserve.set_risk_level",
      entityType: "MerchantRiskProfile",
      entityId: profile.id,
      newValue: { riskLevel, notes },
    });

    return { success: true };
  } catch (error) {
    return { error: "設定失敗" };
  }
}

export async function setReserveRule(
  merchantId: string,
  reservePercent: string,
  holdDays: number
) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    // Deactivate old rules
    await prisma.merchantReserveRule.updateMany({
      where: { merchantId, isActive: true },
      data: { isActive: false },
    });

    const rule = await prisma.merchantReserveRule.create({
      data: {
        merchantId,
        reservePercent,
        holdDays,
        isActive: true,
        createdBy: session.user.id,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "reserve.set_rule",
      entityType: "MerchantReserveRule",
      entityId: rule.id,
      newValue: { reservePercent, holdDays },
    });

    return { success: true };
  } catch (error) {
    return { error: "設定失敗" };
  }
}

export async function releaseReserve(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  const merchantId = formData.get("merchantId") as string;
  const amount = formData.get("amount") as string;
  const reason = formData.get("reason") as string;

  if (!merchantId || !amount) return { error: "請填寫完整資訊" };

  try {
    const wallet = await prisma.merchantWallet.findUnique({ where: { merchantId } });
    if (!wallet) return { error: "錢包不存在" };

    const rule = await prisma.merchantReserveRule.findFirst({
      where: { merchantId, isActive: true },
    });

    await ReserveService.releaseReserve(
      prisma as unknown as PrismaClient,
      {
        walletId: wallet.id,
        amountTaxIncl: amount,
        reserveRuleId: rule?.id || "manual",
        reason,
      }
    );

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "reserve.release",
      entityType: "MerchantWallet",
      entityId: wallet.id,
      newValue: { amount, reason },
    });

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "釋放失敗" };
  }
}

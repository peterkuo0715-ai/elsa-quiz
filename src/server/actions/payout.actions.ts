"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { PayoutService } from "@/server/services/payout.service";
import { LedgerService } from "@/server/services/ledger.service";
import { AuditService } from "@/server/services/audit.service";
import { money } from "@/lib/money";
import type { PrismaClient } from "@/generated/prisma";

export async function requestPayout(formData: FormData) {
  const session = await auth();
  if (!session?.user?.merchantId) {
    return { error: "未登入" };
  }

  const merchantId = session.user.merchantId;
  const amount = formData.get("amount") as string;
  const bankAccountId = formData.get("bankAccountId") as string;

  if (!amount || !bankAccountId) {
    return { error: "請填寫金額並選擇銀行帳號" };
  }

  try {
    // Get wallet and balances
    const wallet = await prisma.merchantWallet.findUnique({
      where: { merchantId },
    });
    if (!wallet) return { error: "找不到錢包" };

    const tx = prisma as unknown as Parameters<typeof LedgerService.getBalances>[0];
    const balances = await LedgerService.getBalances(tx, wallet.id);

    // Validate
    const validation = PayoutService.validatePayoutRequest({
      currentHour: new Date().getHours(),
      availableBalance: balances.available.toString(),
      requestedAmount: amount,
      isFrozen: wallet.isFrozen,
      payoutSuspended: wallet.payoutSuspended,
    });

    if (!validation.valid) {
      return { error: validation.reason };
    }

    // Verify bank account belongs to merchant
    const bankAccount = await prisma.merchantBankAccount.findFirst({
      where: { id: bankAccountId, merchantId, isActive: true },
    });
    if (!bankAccount) {
      return { error: "銀行帳號無效" };
    }

    // Create payout request
    const payoutRequest = await PayoutService.createRequest(
      prisma as unknown as PrismaClient,
      {
        merchantId,
        bankAccountId,
        amountTaxIncl: amount,
        requestedBy: session.user.id,
      }
    );

    // Audit
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "payout.request",
      entityType: "PayoutRequest",
      entityId: payoutRequest.id,
      newValue: {
        amount,
        bankAccountId,
        requestNumber: payoutRequest.requestNumber,
      },
    });

    return { success: true, requestNumber: payoutRequest.requestNumber };
  } catch (error) {
    console.error("Payout request error:", error);
    return {
      error: error instanceof Error ? error.message : "提領申請失敗",
    };
  }
}

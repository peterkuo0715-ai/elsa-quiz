"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { AuditService } from "@/server/services/audit.service";
import { BankAccountChangeStatus } from "@/generated/prisma";

export async function requestBankAccountChange(formData: FormData) {
  const session = await auth();
  if (!session?.user?.merchantId) {
    return { error: "未登入" };
  }

  const merchantId = session.user.merchantId;
  const bankCode = formData.get("bankCode") as string;
  const bankName = formData.get("bankName") as string;
  const branchCode = formData.get("branchCode") as string;
  const branchName = formData.get("branchName") as string;
  const accountNumber = formData.get("accountNumber") as string;
  const accountName = formData.get("accountName") as string;

  if (!bankCode || !bankName || !accountNumber || !accountName) {
    return { error: "請填寫完整銀行資訊" };
  }

  try {
    const request = await prisma.merchantBankAccountChangeRequest.create({
      data: {
        merchantId,
        bankCode,
        bankName,
        branchCode: branchCode || null,
        branchName: branchName || null,
        accountNumber,
        accountName,
        status: BankAccountChangeStatus.PENDING_REVIEW,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "bank_account.change_request",
      entityType: "MerchantBankAccountChangeRequest",
      entityId: request.id,
      newValue: { bankCode, bankName, accountNumber, accountName },
    });

    return { success: true };
  } catch (error) {
    return { error: "申請失敗" };
  }
}

export async function approveBankAccountChange(requestId: string) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const request = await prisma.merchantBankAccountChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== BankAccountChangeStatus.PENDING_REVIEW) {
      return { error: "申請不存在或已處理" };
    }

    // Deactivate old accounts
    await prisma.merchantBankAccount.updateMany({
      where: { merchantId: request.merchantId, isActive: true },
      data: { isActive: false },
    });

    // Create new active account
    await prisma.merchantBankAccount.create({
      data: {
        merchantId: request.merchantId,
        bankCode: request.bankCode,
        bankName: request.bankName,
        branchCode: request.branchCode,
        branchName: request.branchName,
        accountNumber: request.accountNumber,
        accountName: request.accountName,
        isActive: true,
        effectiveAt: new Date(),
      },
    });

    // Update request
    await prisma.merchantBankAccountChangeRequest.update({
      where: { id: requestId },
      data: {
        status: BankAccountChangeStatus.EFFECTIVE,
        reviewedAt: new Date(),
        reviewedBy: session.user.id,
        effectiveAt: new Date(),
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "bank_account.approve_change",
      entityType: "MerchantBankAccountChangeRequest",
      entityId: requestId,
      newValue: { status: "EFFECTIVE" },
    });

    return { success: true };
  } catch (error) {
    return { error: "審核失敗" };
  }
}

export async function rejectBankAccountChange(
  requestId: string,
  reason: string
) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    await prisma.merchantBankAccountChangeRequest.update({
      where: { id: requestId },
      data: {
        status: BankAccountChangeStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: session.user.id,
        rejectionReason: reason,
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "bank_account.reject_change",
      entityType: "MerchantBankAccountChangeRequest",
      entityId: requestId,
      newValue: { status: "REJECTED", reason },
    });

    return { success: true };
  } catch (error) {
    return { error: "審核失敗" };
  }
}

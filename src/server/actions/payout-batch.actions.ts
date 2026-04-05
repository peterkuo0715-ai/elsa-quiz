"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { PayoutService } from "@/server/services/payout.service";
import { AuditService } from "@/server/services/audit.service";
import { PayoutRequestStatus, PayoutBatchStatus } from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";
import type { PrismaClient } from "@/generated/prisma";

/**
 * Create a payout batch from all REQUESTED payout requests.
 */
export async function createPayoutBatch() {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const requests = await prisma.payoutRequest.findMany({
      where: { status: PayoutRequestStatus.REQUESTED },
    });

    if (requests.length === 0) {
      return { error: "沒有待處理的提領申請" };
    }

    const now = new Date();
    const batchNumber = `PB-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    let totalAmount = money(0);
    for (const r of requests) {
      totalAmount = totalAmount.plus(money(r.amountTaxIncl.toString()));
    }

    const batch = await prisma.payoutBatch.create({
      data: {
        batchNumber,
        status: PayoutBatchStatus.CREATED,
        totalItems: requests.length,
        totalAmount: moneyToString(totalAmount),
        createdBy: session.user.id,
        items: {
          create: requests.map((r) => ({
            payoutRequestId: r.id,
          })),
        },
      },
    });

    // Update all requests to QUEUED
    await prisma.payoutRequest.updateMany({
      where: { id: { in: requests.map((r) => r.id) } },
      data: { status: PayoutRequestStatus.QUEUED },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "payout_batch.create",
      entityType: "PayoutBatch",
      entityId: batch.id,
      newValue: {
        batchNumber,
        totalItems: requests.length,
        totalAmount: totalAmount.toString(),
      },
    });

    return { success: true, batchNumber, itemCount: requests.length };
  } catch (error) {
    return { error: "建立批次失敗" };
  }
}

/**
 * Import bank response results for a batch.
 * Each result: { payoutRequestId, success: boolean, failureReason?: string, bankReference?: string }
 */
export async function importBankResponse(
  batchId: string,
  results: Array<{
    payoutRequestId: string;
    success: boolean;
    failureReason?: string;
    bankReference?: string;
  }>
) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    let successCount = 0;
    let failedCount = 0;

    for (const result of results) {
      // Update batch item
      await prisma.payoutBatchItem.updateMany({
        where: { batchId, payoutRequestId: result.payoutRequestId },
        data: {
          isSuccess: result.success,
          failureReason: result.failureReason,
          bankReference: result.bankReference,
          processedAt: new Date(),
        },
      });

      if (result.success) {
        await PayoutService.handleSuccess(
          prisma as unknown as PrismaClient,
          result.payoutRequestId
        );
        successCount++;
      } else {
        await PayoutService.handleFailure(
          prisma as unknown as PrismaClient,
          result.payoutRequestId,
          result.failureReason || "銀行處理失敗"
        );
        failedCount++;
      }
    }

    // Update batch status
    const batchStatus =
      failedCount === 0
        ? PayoutBatchStatus.COMPLETED
        : PayoutBatchStatus.PARTIALLY_FAILED;

    await prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: batchStatus,
        successCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "payout_batch.import_response",
      entityType: "PayoutBatch",
      entityId: batchId,
      newValue: { successCount, failedCount },
    });

    return { success: true, successCount, failedCount };
  } catch (error) {
    return { error: "匯入回檔失敗" };
  }
}

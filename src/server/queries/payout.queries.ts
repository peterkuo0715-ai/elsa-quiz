import { prisma } from "@/server/db";
import type { PayoutRequestStatus } from "@/generated/prisma";

/**
 * Get payout requests for a merchant.
 */
export async function getMerchantPayouts(params: {
  merchantId: string;
  status?: PayoutRequestStatus;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    merchantId: params.merchantId,
  };
  if (params.status) where.status = params.status;

  const [items, total] = await Promise.all([
    prisma.payoutRequest.findMany({
      where,
      include: {
        failures: {
          orderBy: { occurredAt: "desc" },
          take: 1,
        },
        batchItems: {
          include: {
            batch: { select: { batchNumber: true } },
          },
          take: 1,
        },
      },
      skip,
      take: pageSize,
      orderBy: { requestedAt: "desc" },
    }),
    prisma.payoutRequest.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single payout request detail.
 */
export async function getPayoutDetail(payoutId: string, merchantId: string) {
  return prisma.payoutRequest.findFirst({
    where: { id: payoutId, merchantId },
    include: {
      failures: { orderBy: { occurredAt: "desc" } },
      batchItems: {
        include: {
          batch: true,
        },
      },
    },
  });
}

/**
 * Get merchant's active bank accounts.
 */
export async function getMerchantBankAccounts(merchantId: string) {
  return prisma.merchantBankAccount.findMany({
    where: { merchantId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get bank account change requests for a merchant.
 */
export async function getMerchantBankChangeRequests(merchantId: string) {
  return prisma.merchantBankAccountChangeRequest.findMany({
    where: { merchantId },
    orderBy: { requestedAt: "desc" },
  });
}

// ============================================================
// Platform queries
// ============================================================

/**
 * Get all pending payout requests for batch creation.
 */
export async function getPendingPayoutRequests() {
  return prisma.payoutRequest.findMany({
    where: { status: "REQUESTED" },
    include: {
      merchant: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: "asc" },
  });
}

/**
 * Get payout batches for platform management.
 */
export async function getPayoutBatches(params?: {
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    prisma.payoutBatch.findMany({
      include: {
        items: {
          include: {
            payoutRequest: {
              select: {
                requestNumber: true,
                merchantId: true,
                amountTaxIncl: true,
                bankNameSnapshot: true,
                accountNumberSnapshot: true,
                accountNameSnapshot: true,
                merchant: { select: { name: true } },
              },
            },
          },
        },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.payoutBatch.count(),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Get all pending bank account change requests for approval.
 */
export async function getPendingBankChangeRequests() {
  return prisma.merchantBankAccountChangeRequest.findMany({
    where: { status: "PENDING_REVIEW" },
    include: {
      merchant: { select: { id: true, name: true, taxId: true } },
    },
    orderBy: { requestedAt: "asc" },
  });
}

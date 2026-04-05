import { prisma } from "@/server/db";
import type { SettlementItemStatus } from "@/generated/prisma";

export interface ReconciliationFilters {
  merchantId: string;
  dateFrom?: Date;
  dateTo?: Date;
  orderNumber?: string;
  sku?: string;
  storeId?: string;
  status?: SettlementItemStatus;
  hasDispute?: boolean;
  hasRefund?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Get reconciliation list with comprehensive filters.
 * Each row represents a settlement item (1:1 with order item).
 */
export async function getReconciliationList(filters: ReconciliationFilters) {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    merchantId: filters.merchantId,
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  // Build orderItem filter
  const orderItemWhere: Record<string, unknown> = {};
  if (filters.sku) {
    orderItemWhere.sku = { contains: filters.sku, mode: "insensitive" };
  }
  if (filters.storeId) {
    orderItemWhere.storeId = filters.storeId;
  }

  // Build order filter
  const orderWhere: Record<string, unknown> = {};
  if (filters.orderNumber) {
    orderWhere.orderNumber = { contains: filters.orderNumber };
  }

  if (Object.keys(orderItemWhere).length > 0 || Object.keys(orderWhere).length > 0) {
    where.orderItem = {
      ...orderItemWhere,
      ...(Object.keys(orderWhere).length > 0 ? { order: orderWhere } : {}),
    };
  }

  const [items, total] = await Promise.all([
    prisma.settlementItem.findMany({
      where,
      include: {
        orderItem: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                paidAt: true,
              },
            },
            store: {
              select: { id: true, name: true },
            },
            refundItems: {
              select: {
                id: true,
                refundAmountTaxIncl: true,
                refund: { select: { refundNumber: true } },
              },
            },
          },
        },
        batch: {
          select: { id: true, batchNumber: true },
        },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.settlementItem.count({ where }),
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
 * Get a single reconciliation item with full detail.
 * Includes ledger event timeline, related refunds, disputes.
 */
export async function getReconciliationDetail(
  settlementItemId: string,
  merchantId: string
) {
  const item = await prisma.settlementItem.findFirst({
    where: {
      id: settlementItemId,
      merchantId,
    },
    include: {
      orderItem: {
        include: {
          order: true,
          store: true,
          refundItems: {
            include: {
              refund: true,
            },
          },
        },
      },
      batch: true,
    },
  });

  if (!item) return null;

  // Get related ledger entries
  const ledgerEntries = await prisma.walletLedgerEntry.findMany({
    where: {
      referenceType: "SETTLEMENT_ITEM",
      referenceId: settlementItemId,
    },
    orderBy: { createdAt: "asc" },
  });

  // Get related disputes
  const disputes = await prisma.disputeCase.findMany({
    where: {
      merchantId,
      orderItemId: item.orderItemId,
    },
    include: {
      freezes: true,
      evidences: true,
    },
  });

  // Get audit logs
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: "SettlementItem",
      entityId: settlementItemId,
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  return {
    ...item,
    ledgerEntries,
    disputes,
    auditLogs,
  };
}

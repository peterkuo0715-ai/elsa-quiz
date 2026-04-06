import { prisma } from "@/server/db";
import type { SubOrderStatus } from "@/generated/prisma";

export async function getReconciliationList(params: {
  merchantId: string;
  status?: SubOrderStatus;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { merchantId: params.merchantId };
  if (params.status) where.subOrderStatus = params.status;

  const [items, total] = await Promise.all([
    prisma.subOrder.findMany({
      where,
      include: {
        order: { select: { orderNumber: true, paidAt: true } },
        items: { include: { orderItem: { select: { productName: true } } } },
      },
      skip, take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.subOrder.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getReconciliationDetail(subOrderId: string, merchantId: string) {
  const subOrder = await prisma.subOrder.findFirst({
    where: { id: subOrderId, merchantId },
    include: {
      order: true,
      items: { include: { orderItem: true } },
      snapshots: { orderBy: { createdAt: "desc" } },
      refunds: { include: { items: true } },
    },
  });
  if (!subOrder) return null;

  const ledgerEntries = await prisma.walletLedgerEntry.findMany({
    where: { referenceType: "SUB_ORDER", referenceId: subOrderId },
    orderBy: { createdAt: "asc" },
  });

  const disputes = await prisma.disputeCase.findMany({
    where: { merchantId, subOrderId },
    include: { freezes: true },
  });

  return { ...subOrder, ledgerEntries, disputes };
}

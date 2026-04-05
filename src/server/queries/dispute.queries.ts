import { prisma } from "@/server/db";
import type { DisputeStatus } from "@/generated/prisma";

/**
 * Get disputes for a merchant.
 */
export async function getMerchantDisputes(params: {
  merchantId: string;
  status?: DisputeStatus;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { merchantId: params.merchantId };
  if (params.status) where.status = params.status;

  const [items, total] = await Promise.all([
    prisma.disputeCase.findMany({
      where,
      include: {
        freezes: { where: { isFrozen: true } },
        evidences: { orderBy: { createdAt: "desc" }, take: 3 },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.disputeCase.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Get a single dispute detail.
 */
export async function getDisputeDetail(disputeId: string) {
  return prisma.disputeCase.findUnique({
    where: { id: disputeId },
    include: {
      merchant: { select: { id: true, name: true } },
      freezes: { orderBy: { createdAt: "desc" } },
      evidences: {
        orderBy: { createdAt: "desc" },
        include: {
          // no user relation on evidence, submittedBy is a string ID
        },
      },
    },
  });
}

/**
 * Get all disputes for platform management.
 */
export async function getAllDisputes(params?: {
  status?: DisputeStatus;
  merchantId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (params?.status) where.status = params.status;
  if (params?.merchantId) where.merchantId = params.merchantId;
  if (params?.search) {
    where.OR = [
      { caseNumber: { contains: params.search } },
      { disputeReason: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.disputeCase.findMany({
      where,
      include: {
        merchant: { select: { id: true, name: true } },
        freezes: { where: { isFrozen: true } },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.disputeCase.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

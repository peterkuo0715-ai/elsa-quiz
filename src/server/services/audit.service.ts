import type { PrismaClient } from "@/generated/prisma";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface AuditLogParams {
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * AuditService - Records all important operations.
 *
 * Every mutation (create, update, delete, status change) must call audit.log().
 * This provides a complete audit trail for compliance and debugging.
 */
export const AuditService = {
  async log(tx: TxClient, params: AuditLogParams) {
    return tx.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue as object | undefined,
        newValue: params.newValue as object | undefined,
        reason: params.reason,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  },

  async getByEntity(
    tx: TxClient,
    entityType: string,
    entityId: string
  ) {
    return tx.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  },

  async getByUser(tx: TxClient, userId: string, limit: number = 50) {
    return tx.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};

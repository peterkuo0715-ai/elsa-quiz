import type { PrismaClient } from "@/generated/prisma";
import { IDEMPOTENCY_KEY_TTL_HOURS } from "@/lib/constants";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * IdempotencyService - Prevents duplicate processing of webhooks and callbacks.
 *
 * Usage:
 * 1. check(key) - returns cached response if the key was already processed
 * 2. set(key, endpoint, response) - stores the result after processing
 * 3. Keys expire after 24 hours and are cleaned up by cron
 */
export const IdempotencyService = {
  async check(tx: TxClient, key: string) {
    const existing = await tx.idempotencyKey.findUnique({
      where: { key },
    });

    if (!existing) return null;

    // Check if expired
    if (existing.expiresAt < new Date()) {
      await tx.idempotencyKey.delete({ where: { key } });
      return null;
    }

    return existing.response;
  },

  async set(
    tx: TxClient,
    key: string,
    endpoint: string,
    response: unknown
  ) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_KEY_TTL_HOURS);

    return tx.idempotencyKey.upsert({
      where: { key },
      update: { response: response as object, expiresAt },
      create: {
        key,
        endpoint,
        response: response as object,
        expiresAt,
      },
    });
  },

  async cleanup(tx: TxClient) {
    const result = await tx.idempotencyKey.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  },
};

import Decimal from "decimal.js";
import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
} from "@/generated/prisma";
import { money, moneyAdd, moneyRound, moneyToString, ZERO } from "@/lib/money";
import type { PrismaClient } from "@/generated/prisma";

// Type for Prisma transaction client
type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface CreateLedgerEntryParams {
  walletId: string;
  bucket: WalletBucket;
  entryType: LedgerEntryType;
  /** Positive = credit, Negative = debit */
  amount: Decimal;
  amountTaxIncl: Decimal;
  amountTaxExcl: Decimal;
  taxAmount: Decimal;
  referenceType?: ReferenceType;
  referenceId?: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WalletBalances {
  pending: Decimal;
  available: Decimal;
  reserved: Decimal;
  inTransit: Decimal;
}

/**
 * LedgerService - The core of the financial system.
 *
 * All balance changes MUST flow through createEntry().
 * Balances are ALWAYS derived from ledger entries.
 * This is an append-only ledger - entries are NEVER updated or deleted.
 */
export const LedgerService = {
  /**
   * Create a new ledger entry within a transaction.
   *
   * 1. Check idempotency - if key exists, return existing entry
   * 2. Read latest balanceAfter for the target bucket
   * 3. Compute new balance
   * 4. Validate (available cannot go below zero unless NEGATIVE_BALANCE_CARRY)
   * 5. Insert new entry with balanceAfter
   */
  async createEntry(tx: TxClient, params: CreateLedgerEntryParams) {
    // 1. Idempotency check
    const existing = await tx.walletLedgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return existing;
    }

    // 2. Get latest balance for this bucket
    const latestEntry = await tx.walletLedgerEntry.findFirst({
      where: {
        walletId: params.walletId,
        bucket: params.bucket,
      },
      orderBy: { createdAt: "desc" },
      select: { balanceAfter: true },
    });

    const previousBalance = latestEntry
      ? money(latestEntry.balanceAfter.toString())
      : ZERO;

    // 3. Compute new balance
    const newBalance = moneyRound(moneyAdd(previousBalance, params.amount));

    // 4. Validate - available bucket cannot go negative
    // (except for NEGATIVE_BALANCE_CARRY which explicitly allows it)
    if (
      params.bucket === WalletBucket.AVAILABLE &&
      newBalance.isNegative() &&
      params.entryType !== LedgerEntryType.NEGATIVE_BALANCE_CARRY
    ) {
      throw new Error(
        `Insufficient available balance. Current: ${previousBalance.toString()}, Requested: ${params.amount.toString()}`
      );
    }

    // 5. Insert the new entry
    const entry = await tx.walletLedgerEntry.create({
      data: {
        walletId: params.walletId,
        bucket: params.bucket,
        entryType: params.entryType,
        amount: moneyToString(params.amount),
        amountTaxIncl: moneyToString(params.amountTaxIncl),
        amountTaxExcl: moneyToString(params.amountTaxExcl),
        taxAmount: moneyToString(params.taxAmount),
        balanceAfter: moneyToString(newBalance),
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
        description: params.description,
        metadata: params.metadata as object | undefined,
      },
    });

    return entry;
  },

  /**
   * Get current balances for a wallet by reading the latest entry per bucket.
   * O(4) queries - one per bucket.
   */
  async getBalances(tx: TxClient, walletId: string): Promise<WalletBalances> {
    const buckets = [
      WalletBucket.PENDING,
      WalletBucket.AVAILABLE,
      WalletBucket.RESERVED,
      WalletBucket.IN_TRANSIT,
    ] as const;

    const results = await Promise.all(
      buckets.map((bucket) =>
        tx.walletLedgerEntry.findFirst({
          where: { walletId, bucket },
          orderBy: { createdAt: "desc" },
          select: { balanceAfter: true },
        })
      )
    );

    return {
      pending: results[0] ? money(results[0].balanceAfter.toString()) : ZERO,
      available: results[1] ? money(results[1].balanceAfter.toString()) : ZERO,
      reserved: results[2] ? money(results[2].balanceAfter.toString()) : ZERO,
      inTransit: results[3] ? money(results[3].balanceAfter.toString()) : ZERO,
    };
  },

  /**
   * Recalculate balances from scratch by summing all entries.
   * Used for auditing and snapshot generation.
   */
  async recalculateBalances(
    tx: TxClient,
    walletId: string
  ): Promise<WalletBalances> {
    const buckets = [
      WalletBucket.PENDING,
      WalletBucket.AVAILABLE,
      WalletBucket.RESERVED,
      WalletBucket.IN_TRANSIT,
    ] as const;

    const results = await Promise.all(
      buckets.map((bucket) =>
        tx.walletLedgerEntry.aggregate({
          where: { walletId, bucket },
          _sum: { amount: true },
        })
      )
    );

    return {
      pending: results[0]._sum.amount
        ? money(results[0]._sum.amount.toString())
        : ZERO,
      available: results[1]._sum.amount
        ? money(results[1]._sum.amount.toString())
        : ZERO,
      reserved: results[2]._sum.amount
        ? money(results[2]._sum.amount.toString())
        : ZERO,
      inTransit: results[3]._sum.amount
        ? money(results[3]._sum.amount.toString())
        : ZERO,
    };
  },

  /**
   * Get ledger entries for a specific reference (e.g., all entries for an order item).
   */
  async getEntriesByReference(
    tx: TxClient,
    referenceType: ReferenceType,
    referenceId: string
  ) {
    return tx.walletLedgerEntry.findMany({
      where: { referenceType, referenceId },
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Get recent ledger entries for a wallet (for timeline display).
   */
  async getRecentEntries(
    tx: TxClient,
    walletId: string,
    limit: number = 50
  ) {
    return tx.walletLedgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};

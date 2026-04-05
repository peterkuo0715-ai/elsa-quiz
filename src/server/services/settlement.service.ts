import {
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
  SettlementItemStatus,
  SettlementBatchStatus,
} from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerService } from "./ledger.service";
import { money, moneyMul, moneySub, moneyRound, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { SETTLEMENT_BATCH_CHUNK_SIZE } from "@/lib/constants";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * SettlementService - Handles daily settlement batch processing.
 *
 * Flow:
 * 1. Find settlement items where appreciation period has ended
 * 2. For each item, create ledger entries:
 *    - ORDER_CAPTURED to PENDING
 *    - SETTLEMENT_RELEASED from PENDING to AVAILABLE
 *    - COMMISSION_CHARGED from AVAILABLE (platform takes commission)
 *    - SHIPPING_INCOME_RECOGNIZED to AVAILABLE (100% to merchant)
 *    - RESERVE_HOLD from AVAILABLE to RESERVED (if risk rules exist)
 * 3. Update settlement item status
 */
export const SettlementService = {
  /**
   * Run the daily settlement batch.
   * Finds all items past appreciation period and settles them.
   */
  async runBatch(prisma: PrismaClient, triggeredBy?: string) {
    const now = new Date();
    const batchNumber = `STL-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    // Create batch record
    const batch = await prisma.settlementBatch.create({
      data: {
        batchNumber,
        status: SettlementBatchStatus.PROCESSING,
        triggeredBy,
        startedAt: now,
      },
    });

    let successCount = 0;
    let failedCount = 0;
    let totalAmount = money(0);

    try {
      // Find ready items in chunks
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const items = await prisma.settlementItem.findMany({
          where: {
            status: SettlementItemStatus.IN_APPRECIATION_PERIOD,
            appreciationEndsAt: { lte: now },
          },
          take: SETTLEMENT_BATCH_CHUNK_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: "asc" },
          include: {
            orderItem: {
              include: {
                order: {
                  include: { merchant: { include: { wallet: true, reserveRules: { where: { isActive: true } } } } },
                },
              },
            },
          },
        });

        if (items.length < SETTLEMENT_BATCH_CHUNK_SIZE) {
          hasMore = false;
        }
        if (items.length > 0) {
          cursor = items[items.length - 1].id;
        }

        // Process each item
        for (const item of items) {
          try {
            await this.settleItem(prisma, item, batch.id);
            successCount++;
            totalAmount = totalAmount.plus(money(item.netAmountTaxIncl.toString()));
          } catch (error) {
            failedCount++;
            console.error(`Failed to settle item ${item.id}:`, error);
          }
        }
      }

      // Update batch
      await prisma.settlementBatch.update({
        where: { id: batch.id },
        data: {
          status: SettlementBatchStatus.COMPLETED,
          totalItems: successCount + failedCount,
          totalAmount: moneyToString(totalAmount),
          successCount,
          failedCount,
          completedAt: new Date(),
        },
      });

      return { batchId: batch.id, successCount, failedCount };
    } catch (error) {
      await prisma.settlementBatch.update({
        where: { id: batch.id },
        data: {
          status: SettlementBatchStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date(),
        },
      });
      throw error;
    }
  },

  /**
   * Settle a single item within a transaction.
   */
  async settleItem(
    prisma: PrismaClient,
    item: {
      id: string;
      merchantId: string;
      netAmountTaxIncl: { toString(): string };
      netAmountTaxExcl: { toString(): string };
      netTaxAmount: { toString(): string };
      netSettlementAmount?: { toString(): string };
      commissionAmount: { toString(): string };
      orderItem: {
        order: {
          merchant: {
            wallet: { id: string } | null;
            reserveRules: Array<{ reservePercent: { toString(): string } }>;
          };
        };
      };
    },
    batchId: string
  ) {
    const wallet = item.orderItem.order.merchant.wallet;
    if (!wallet) throw new Error(`No wallet for merchant ${item.merchantId}`);

    const netAmount = money(item.netAmountTaxIncl.toString());
    const netAmountTaxExcl = money(item.netAmountTaxExcl.toString());
    const netTax = money(item.netTaxAmount.toString());

    // Calculate reserve if applicable
    const reserveRules = item.orderItem.order.merchant.reserveRules;
    let reserveAmount = money(0);
    if (reserveRules.length > 0) {
      const reservePercent = money(reserveRules[0].reservePercent.toString());
      reserveAmount = moneyRound(moneyMul(netAmount, reservePercent));
    }

    // Use $transaction for atomicity
    // Note: Prisma Accelerate doesn't support interactive transactions,
    // so we use sequential operations with idempotency keys
    const baseKey = `settle-${item.id}`;

    // 1. SETTLEMENT_RELEASED: PENDING -> AVAILABLE (the net amount)
    await LedgerService.createEntry(prisma as unknown as Parameters<typeof LedgerService.createEntry>[0], {
      walletId: wallet.id,
      bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.SETTLEMENT_RELEASED,
      amount: netAmount,
      amountTaxIncl: netAmount,
      amountTaxExcl: netAmountTaxExcl,
      taxAmount: netTax,
      referenceType: ReferenceType.SETTLEMENT_ITEM,
      referenceId: item.id,
      idempotencyKey: `${baseKey}-release`,
      description: "鑑賞期結束，款項釋放至可用餘額",
    });

    // 2. If reserve applies, RESERVE_HOLD: AVAILABLE -> RESERVED
    if (!reserveAmount.isZero()) {
      const reserveBreakdown = taxInclToBreakdown(reserveAmount);
      await LedgerService.createEntry(prisma as unknown as Parameters<typeof LedgerService.createEntry>[0], {
        walletId: wallet.id,
        bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.RESERVE_HOLD,
        amount: reserveAmount.negated(),
        amountTaxIncl: reserveBreakdown.taxIncl.negated(),
        amountTaxExcl: reserveBreakdown.taxExcl.negated(),
        taxAmount: reserveBreakdown.taxAmount.negated(),
        referenceType: ReferenceType.SETTLEMENT_ITEM,
        referenceId: item.id,
        idempotencyKey: `${baseKey}-reserve-avail`,
        description: "風險保留金扣留",
      });

      await LedgerService.createEntry(prisma as unknown as Parameters<typeof LedgerService.createEntry>[0], {
        walletId: wallet.id,
        bucket: WalletBucket.RESERVED,
        entryType: LedgerEntryType.RESERVE_HOLD,
        amount: reserveAmount,
        amountTaxIncl: reserveBreakdown.taxIncl,
        amountTaxExcl: reserveBreakdown.taxExcl,
        taxAmount: reserveBreakdown.taxAmount,
        referenceType: ReferenceType.SETTLEMENT_ITEM,
        referenceId: item.id,
        idempotencyKey: `${baseKey}-reserve-hold`,
        description: "風險保留金入帳",
      });
    }

    // 3. Update settlement item
    await prisma.settlementItem.update({
      where: { id: item.id },
      data: {
        status: SettlementItemStatus.AVAILABLE_FOR_PAYOUT,
        batchId,
        settledAt: new Date(),
        reserveAmount: moneyToString(reserveAmount),
      },
    });
  },
};

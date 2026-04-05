import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { IdempotencyService } from "@/server/services/idempotency.service";
import { RefundService } from "@/server/services/refund.service";
import { RefundType, SettlementItemStatus } from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import type { PrismaClient } from "@/generated/prisma";

/**
 * POST /api/webhooks/refund
 * Handles refund webhook from payment gateway.
 * Idempotent - safe to retry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      refundType, // "FULL" | "PARTIAL"
      reason,
      items, // Array<{ orderItemId, refundAmountTaxIncl }>
      idempotencyKey,
    } = body;

    if (!idempotencyKey) {
      return NextResponse.json({ error: "Missing idempotencyKey" }, { status: 400 });
    }

    const tx = prisma as Parameters<typeof IdempotencyService.check>[0];
    const existing = await IdempotencyService.check(tx, idempotencyKey);
    if (existing) {
      return NextResponse.json(existing);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { settlementItem: true } },
        merchant: { include: { wallet: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (!order.merchant.wallet) {
      return NextResponse.json({ error: "Merchant wallet not found" }, { status: 404 });
    }

    const now = new Date();
    const refundNumber = `RF-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    let totalRefundIncl = money(0);
    let totalRefundExcl = money(0);
    let totalRefundTax = money(0);

    const refundItemsData = items.map(
      (ri: { orderItemId: string; refundAmountTaxIncl: string | number }) => {
        const orderItem = order.items.find((oi) => oi.id === ri.orderItemId);
        if (!orderItem) throw new Error(`Order item ${ri.orderItemId} not found`);

        const breakdown = RefundService.calculateRefundBreakdown({
          refundAmountTaxIncl: ri.refundAmountTaxIncl,
          originalItemAmountTaxIncl: orderItem.discountedPriceTaxIncl.toString(),
          originalCommission: orderItem.platformCommission.toString(),
          campaignDiscount: orderItem.campaignDiscount.toString(),
        });

        const refundBreakdown = taxInclToBreakdown(ri.refundAmountTaxIncl);
        totalRefundIncl = totalRefundIncl.plus(refundBreakdown.taxIncl);
        totalRefundExcl = totalRefundExcl.plus(refundBreakdown.taxExcl);
        totalRefundTax = totalRefundTax.plus(refundBreakdown.taxAmount);

        return {
          orderItemId: ri.orderItemId,
          refundAmountTaxIncl: moneyToString(refundBreakdown.taxIncl),
          refundAmountTaxExcl: moneyToString(refundBreakdown.taxExcl),
          refundTaxAmount: moneyToString(refundBreakdown.taxAmount),
          commissionRefund: moneyToString(breakdown.commissionRefund),
          campaignCostRecovery: moneyToString(breakdown.campaignCostRecovery),
          netMerchantDebit: moneyToString(breakdown.netMerchantDebit),
        };
      }
    );

    const refund = await prisma.refund.create({
      data: {
        refundNumber,
        orderId,
        refundType: refundType === "FULL" ? RefundType.FULL : RefundType.PARTIAL,
        totalAmountTaxIncl: moneyToString(totalRefundIncl),
        totalAmountTaxExcl: moneyToString(totalRefundExcl),
        totalTaxAmount: moneyToString(totalRefundTax),
        reason,
        processedAt: now,
        processedBy: "webhook",
        items: { create: refundItemsData },
      },
      include: { items: true },
    });

    // Process ledger entries
    for (const ri of refund.items) {
      await RefundService.processRefundItem(
        prisma as unknown as PrismaClient,
        {
          walletId: order.merchant.wallet.id,
          refundItemId: ri.id,
          netMerchantDebit: ri.netMerchantDebit.toString(),
          commissionRefund: ri.commissionRefund.toString(),
          campaignCostRecovery: ri.campaignCostRecovery.toString(),
        }
      );

      // Update settlement item
      const orderItem = order.items.find((oi) => oi.id === ri.orderItemId);
      if (orderItem?.settlementItem) {
        await prisma.settlementItem.update({
          where: { id: orderItem.settlementItem.id },
          data: {
            status:
              refundType === "FULL"
                ? SettlementItemStatus.REFUNDED
                : SettlementItemStatus.PARTIALLY_REFUNDED,
          },
        });
      }
    }

    const response = {
      success: true,
      refundNumber,
      itemCount: refund.items.length,
      totalRefund: totalRefundIncl.toString(),
    };

    await IdempotencyService.set(tx, idempotencyKey, "webhooks/refund", response);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Refund webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

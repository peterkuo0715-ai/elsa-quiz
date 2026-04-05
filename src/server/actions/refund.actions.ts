"use server";

import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { RefundService } from "@/server/services/refund.service";
import { AuditService } from "@/server/services/audit.service";
import { RefundType, SettlementItemStatus } from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import type { PrismaClient } from "@/generated/prisma";

/**
 * Process a refund (called from webhook or platform manual).
 */
export async function processRefund(params: {
  orderId: string;
  refundType: "FULL" | "PARTIAL";
  reason?: string;
  items: Array<{
    orderItemId: string;
    refundAmountTaxIncl: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) return { error: "未登入" };

  try {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        items: {
          include: {
            settlementItem: true,
          },
        },
        merchant: { include: { wallet: true } },
      },
    });

    if (!order) return { error: "訂單不存在" };
    if (!order.merchant.wallet) return { error: "商家錢包不存在" };

    const now = new Date();
    const refundNumber = `RF-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    let totalRefundIncl = money(0);
    let totalRefundExcl = money(0);
    let totalRefundTax = money(0);

    // Calculate breakdown for each item
    const refundItemsData = params.items.map((ri) => {
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
    });

    // Create refund + refund items
    const refund = await prisma.refund.create({
      data: {
        refundNumber,
        orderId: params.orderId,
        refundType: params.refundType === "FULL" ? RefundType.FULL : RefundType.PARTIAL,
        totalAmountTaxIncl: moneyToString(totalRefundIncl),
        totalAmountTaxExcl: moneyToString(totalRefundExcl),
        totalTaxAmount: moneyToString(totalRefundTax),
        reason: params.reason,
        processedAt: now,
        processedBy: session.user.id,
        items: {
          create: refundItemsData,
        },
      },
      include: { items: true },
    });

    // Process ledger entries for each refund item
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

      // Update settlement item status
      const orderItem = order.items.find((oi) => oi.id === ri.orderItemId);
      if (orderItem?.settlementItem) {
        const newStatus =
          params.refundType === "FULL"
            ? SettlementItemStatus.REFUNDED
            : SettlementItemStatus.PARTIALLY_REFUNDED;

        await prisma.settlementItem.update({
          where: { id: orderItem.settlementItem.id },
          data: { status: newStatus },
        });
      }
    }

    const tx = prisma as Parameters<typeof AuditService.log>[0];
    await AuditService.log(tx, {
      userId: session.user.id,
      action: "refund.process",
      entityType: "Refund",
      entityId: refund.id,
      newValue: {
        refundNumber,
        refundType: params.refundType,
        totalAmount: totalRefundIncl.toString(),
        itemCount: refund.items.length,
      },
    });

    return { success: true, refundNumber };
  } catch (error) {
    console.error("Refund error:", error);
    return { error: error instanceof Error ? error.message : "退款處理失敗" };
  }
}

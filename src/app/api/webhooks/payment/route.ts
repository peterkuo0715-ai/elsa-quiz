import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { IdempotencyService } from "@/server/services/idempotency.service";
import { SettlementItemStatus } from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { APPRECIATION_PERIOD_DAYS } from "@/lib/constants";

/**
 * POST /api/webhooks/payment
 * Handles payment success webhook from payment gateway.
 *
 * Creates order, order items, settlement items.
 * Idempotent - safe to retry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      orderNumber,
      merchantId,
      items,
      shippingFee,
      paymentMethod,
      paymentFee,
      paidAt,
      idempotencyKey,
    } = body;

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Missing idempotencyKey" },
        { status: 400 }
      );
    }

    // Idempotency check
    const tx = prisma as Parameters<typeof IdempotencyService.check>[0];
    const existing = await IdempotencyService.check(tx, idempotencyKey);
    if (existing) {
      return NextResponse.json(existing);
    }

    // Calculate totals
    const shippingBreakdown = taxInclToBreakdown(shippingFee || 0);
    let totalTaxIncl = money(0);
    let totalTaxExcl = money(0);
    let totalTax = money(0);

    const orderItems = items.map(
      (item: {
        productName: string;
        sku?: string;
        storeId?: string;
        quantity: number;
        unitPriceTaxIncl: number;
        discountAmount?: number;
        platformCommissionRate?: number;
        campaignId?: string;
        campaignDiscount?: number;
      }) => {
        const unitBreakdown = taxInclToBreakdown(item.unitPriceTaxIncl);
        const subtotalIncl = moneyRound(
          moneyMul(unitBreakdown.taxIncl, item.quantity)
        );
        const subtotalExcl = moneyRound(
          moneyMul(unitBreakdown.taxExcl, item.quantity)
        );
        const subtotalTax = moneyRound(subtotalIncl.minus(subtotalExcl));

        const discount = money(item.discountAmount || 0);
        const discountedIncl = moneyRound(moneySub(subtotalIncl, discount));
        const discountedBreakdown = taxInclToBreakdown(discountedIncl);

        const commRate = money(item.platformCommissionRate || 0);
        const commission = moneyRound(
          moneyMul(discountedBreakdown.taxExcl, commRate)
        );

        totalTaxIncl = totalTaxIncl.plus(subtotalIncl);
        totalTaxExcl = totalTaxExcl.plus(subtotalExcl);
        totalTax = totalTax.plus(subtotalTax);

        return {
          productName: item.productName,
          sku: item.sku,
          storeId: item.storeId,
          quantity: item.quantity,
          unitPriceTaxIncl: moneyToString(unitBreakdown.taxIncl),
          unitPriceTaxExcl: moneyToString(unitBreakdown.taxExcl),
          unitTaxAmount: moneyToString(unitBreakdown.taxAmount),
          subtotalTaxIncl: moneyToString(subtotalIncl),
          subtotalTaxExcl: moneyToString(subtotalExcl),
          subtotalTaxAmount: moneyToString(subtotalTax),
          discountAmount: moneyToString(discount),
          discountedPriceTaxIncl: moneyToString(discountedBreakdown.taxIncl),
          discountedPriceTaxExcl: moneyToString(discountedBreakdown.taxExcl),
          platformCommissionRate: moneyToString(commRate),
          platformCommission: moneyToString(commission),
          campaignId: item.campaignId,
          campaignDiscount: moneyToString(money(item.campaignDiscount || 0)),
        };
      }
    );

    // Create order + items + settlement items
    const order = await prisma.order.create({
      data: {
        id: orderId,
        orderNumber,
        merchantId,
        totalAmountTaxIncl: moneyToString(totalTaxIncl),
        totalAmountTaxExcl: moneyToString(totalTaxExcl),
        totalTaxAmount: moneyToString(totalTax),
        shippingFeeTaxIncl: moneyToString(shippingBreakdown.taxIncl),
        shippingFeeTaxExcl: moneyToString(shippingBreakdown.taxExcl),
        shippingTaxAmount: moneyToString(shippingBreakdown.taxAmount),
        paymentMethod,
        paymentFee: moneyToString(money(paymentFee || 0)),
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        items: {
          create: orderItems,
        },
      },
      include: { items: true },
    });

    // Create settlement items for each order item
    for (const oi of order.items) {
      const commissionAmount = money(oi.platformCommission.toString());
      const itemAmount = money(oi.discountedPriceTaxIncl.toString());
      const itemAmountBreakdown = taxInclToBreakdown(itemAmount);
      const netAmount = moneyRound(moneySub(itemAmount, commissionAmount));
      const netBreakdown = taxInclToBreakdown(netAmount);

      await prisma.settlementItem.create({
        data: {
          orderItemId: oi.id,
          merchantId,
          status: SettlementItemStatus.PAID,
          itemAmountTaxIncl: moneyToString(itemAmountBreakdown.taxIncl),
          itemAmountTaxExcl: moneyToString(itemAmountBreakdown.taxExcl),
          itemTaxAmount: moneyToString(itemAmountBreakdown.taxAmount),
          commissionAmount: moneyToString(commissionAmount),
          commissionRate: oi.platformCommissionRate.toString(),
          campaignCost: oi.campaignDiscount.toString(),
          netAmountTaxIncl: moneyToString(netBreakdown.taxIncl),
          netAmountTaxExcl: moneyToString(netBreakdown.taxExcl),
          netTaxAmount: moneyToString(netBreakdown.taxAmount),
          paidAt: order.paidAt,
        },
      });
    }

    const response = {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      itemCount: order.items.length,
    };

    // Save idempotency
    await IdempotencyService.set(tx, idempotencyKey, "webhooks/payment", response);

    return NextResponse.json(response);
  } catch (error) {
    console.error("Payment webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

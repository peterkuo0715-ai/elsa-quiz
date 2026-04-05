import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { IdempotencyService } from "@/server/services/idempotency.service";
import { SettlementItemStatus } from "@/generated/prisma";
import { APPRECIATION_PERIOD_DAYS } from "@/lib/constants";
import { addDays } from "date-fns";

/**
 * POST /api/webhooks/logistics
 * Handles logistics status update (shipped / delivered).
 * Idempotent - safe to retry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      trackingNo,
      carrier,
      status, // "shipped" | "delivered"
      timestamp,
      idempotencyKey,
    } = body;

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Missing idempotencyKey" },
        { status: 400 }
      );
    }

    const tx = prisma as Parameters<typeof IdempotencyService.check>[0];
    const existing = await IdempotencyService.check(tx, idempotencyKey);
    if (existing) {
      return NextResponse.json(existing);
    }

    const eventTime = timestamp ? new Date(timestamp) : new Date();

    if (status === "shipped") {
      // Create/update shipment
      await prisma.shipment.upsert({
        where: { id: `ship-${orderId}-${trackingNo}` },
        update: { shippedAt: eventTime },
        create: {
          id: `ship-${orderId}-${trackingNo}`,
          orderId,
          trackingNo,
          carrier,
          shippedAt: eventTime,
        },
      });

      // Update settlement items status
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId },
        select: { id: true },
      });

      for (const oi of orderItems) {
        await prisma.settlementItem.updateMany({
          where: {
            orderItemId: oi.id,
            status: SettlementItemStatus.PAID,
          },
          data: {
            status: SettlementItemStatus.SHIPPED,
            shippedAt: eventTime,
          },
        });
      }
    } else if (status === "delivered") {
      // Update shipment
      await prisma.shipment.updateMany({
        where: { orderId, trackingNo },
        data: { deliveredAt: eventTime },
      });

      // Update settlement items: SHIPPED → DELIVERED → IN_APPRECIATION_PERIOD
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId },
        select: { id: true },
      });

      const appreciationEndsAt = addDays(eventTime, APPRECIATION_PERIOD_DAYS);

      for (const oi of orderItems) {
        await prisma.settlementItem.updateMany({
          where: {
            orderItemId: oi.id,
            status: {
              in: [
                SettlementItemStatus.SHIPPED,
                SettlementItemStatus.DELIVERED,
              ],
            },
          },
          data: {
            status: SettlementItemStatus.IN_APPRECIATION_PERIOD,
            deliveredAt: eventTime,
            appreciationEndsAt,
          },
        });
      }
    }

    const response = {
      success: true,
      orderId,
      status,
      timestamp: eventTime.toISOString(),
    };

    await IdempotencyService.set(tx, idempotencyKey, "webhooks/logistics", response);

    return NextResponse.json(response);
  } catch (error) {
    console.error("Logistics webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

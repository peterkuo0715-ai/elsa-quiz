import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { PayoutRequestStatus, PayoutBatchStatus } from "@/generated/prisma";
import { money, moneyToString } from "@/lib/money";

/**
 * POST /api/cron/payout
 * Daily payout batch processing cron.
 * Auto-creates a batch from all REQUESTED payouts.
 * Secured by CRON_SECRET header.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const requests = await prisma.payoutRequest.findMany({
      where: { status: PayoutRequestStatus.REQUESTED },
    });

    if (requests.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending payout requests",
        batchCreated: false,
      });
    }

    const now = new Date();
    const batchNumber = `PB-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now()}`;

    let totalAmount = money(0);
    for (const r of requests) {
      totalAmount = totalAmount.plus(money(r.amountTaxIncl.toString()));
    }

    const batch = await prisma.payoutBatch.create({
      data: {
        batchNumber,
        status: PayoutBatchStatus.CREATED,
        totalItems: requests.length,
        totalAmount: moneyToString(totalAmount),
        createdBy: "cron",
        items: {
          create: requests.map((r) => ({
            payoutRequestId: r.id,
          })),
        },
      },
    });

    await prisma.payoutRequest.updateMany({
      where: { id: { in: requests.map((r) => r.id) } },
      data: { status: PayoutRequestStatus.QUEUED },
    });

    return NextResponse.json({
      success: true,
      batchCreated: true,
      batchId: batch.id,
      batchNumber,
      itemCount: requests.length,
      totalAmount: totalAmount.toString(),
    });
  } catch (error) {
    console.error("Payout cron failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

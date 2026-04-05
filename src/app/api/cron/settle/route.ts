import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { SettlementService } from "@/server/services/settlement.service";
import type { PrismaClient } from "@/generated/prisma";

/**
 * POST /api/cron/settle
 * Daily settlement batch - releases funds past appreciation period.
 * Secured by CRON_SECRET header.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await SettlementService.runBatch(
      prisma as unknown as PrismaClient,
      "cron"
    );

    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      successCount: result.successCount,
      failedCount: result.failedCount,
    });
  } catch (error) {
    console.error("Settlement batch failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

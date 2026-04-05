import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { generateMonthlyStatement } from "@/server/queries/statement.queries";

/**
 * POST /api/cron/snapshot
 * Generate monthly statements and balance snapshots.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);

    // If specific merchant/month provided, generate for that
    if (body?.merchantId && body?.year && body?.month) {
      const statement = await generateMonthlyStatement(
        body.merchantId,
        body.year,
        body.month
      );
      return NextResponse.json({ success: true, statementId: statement.id });
    }

    // Otherwise generate for all merchants for last month
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();

    const merchants = await prisma.merchant.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let generated = 0;
    for (const m of merchants) {
      try {
        await generateMonthlyStatement(m.id, year, month);
        generated++;
      } catch (error) {
        console.error(`Failed to generate statement for ${m.id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      merchantCount: merchants.length,
      generated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

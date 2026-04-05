import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { money, ZERO } from "@/lib/money";
import { subDays, startOfDay, format } from "date-fns";

/**
 * Get projected income breakdown (未結算的預計入帳).
 * Three tiers:
 * 1. IN_APPRECIATION_PERIOD: delivered, waiting for 7-day period
 * 2. SHIPPED: shipped but not yet delivered
 * 3. PAID: paid but not yet shipped
 */
export async function getProjectedIncome(merchantId: string) {
  const [appreciation, shipped, paid] = await Promise.all([
    prisma.settlementItem.findMany({
      where: { merchantId, status: "IN_APPRECIATION_PERIOD" },
      select: { netAmountTaxIncl: true, appreciationEndsAt: true },
    }),
    prisma.settlementItem.findMany({
      where: { merchantId, status: "SHIPPED" },
      select: { netAmountTaxIncl: true },
    }),
    prisma.settlementItem.findMany({
      where: { merchantId, status: "PAID" },
      select: { netAmountTaxIncl: true },
    }),
  ]);

  const appreciationTotal = appreciation.reduce(
    (sum, item) => sum.plus(money(item.netAmountTaxIncl.toString())),
    ZERO
  );
  const shippedTotal = shipped.reduce(
    (sum, item) => sum.plus(money(item.netAmountTaxIncl.toString())),
    ZERO
  );
  const paidTotal = paid.reduce(
    (sum, item) => sum.plus(money(item.netAmountTaxIncl.toString())),
    ZERO
  );
  const total = appreciationTotal.plus(shippedTotal).plus(paidTotal);

  // Find nearest appreciation end date
  let nearestEndDate: Date | null = null;
  for (const item of appreciation) {
    if (item.appreciationEndsAt) {
      const d = new Date(item.appreciationEndsAt);
      if (!nearestEndDate || d < nearestEndDate) nearestEndDate = d;
    }
  }

  return {
    total,
    appreciation: {
      count: appreciation.length,
      amount: appreciationTotal,
      nearestEndDate,
    },
    shipped: {
      count: shipped.length,
      amount: shippedTotal,
    },
    paid: {
      count: paid.length,
      amount: paidTotal,
    },
  };
}

/**
 * Get daily trend data for the chart.
 * Returns daily income (credits) and deductions (debits) for last N days.
 */
export async function getDailyTrend(merchantId: string, days: number = 7) {
  const wallet = await prisma.merchantWallet.findUnique({
    where: { merchantId },
  });
  if (!wallet) return [];

  const startDate = startOfDay(subDays(new Date(), days - 1));

  const entries = await prisma.walletLedgerEntry.findMany({
    where: {
      walletId: wallet.id,
      createdAt: { gte: startDate },
    },
    select: {
      amountTaxIncl: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Aggregate by day
  const dailyMap = new Map<string, { income: typeof ZERO; deductions: typeof ZERO }>();

  // Initialize all days
  for (let i = 0; i < days; i++) {
    const date = format(subDays(new Date(), days - 1 - i), "MM/dd");
    dailyMap.set(date, { income: ZERO, deductions: ZERO });
  }

  for (const entry of entries) {
    const date = format(new Date(entry.createdAt), "MM/dd");
    const current = dailyMap.get(date) || { income: ZERO, deductions: ZERO };
    const amount = money(entry.amountTaxIncl.toString());

    if (amount.isPositive()) {
      current.income = current.income.plus(amount);
    } else {
      current.deductions = current.deductions.plus(amount.abs());
    }

    dailyMap.set(date, current);
  }

  return Array.from(dailyMap.entries()).map(([date, data]) => ({
    date,
    income: Number(data.income.toFixed(0)),
    deductions: Number(data.deductions.toFixed(0)),
  }));
}

/**
 * Get pending action counts for the dashboard.
 */
export async function getPendingActions(merchantId: string) {
  const [disputeCount, pendingBankChange, wallet] = await Promise.all([
    prisma.disputeCase.count({
      where: {
        merchantId,
        status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] },
      },
    }),
    prisma.merchantBankAccountChangeRequest.count({
      where: { merchantId, status: "PENDING_REVIEW" },
    }),
    prisma.merchantWallet.findUnique({
      where: { merchantId },
      select: { isFrozen: true, payoutSuspended: true, frozenReason: true },
    }),
  ]);

  return {
    activeDisputes: disputeCount,
    pendingBankChange,
    isFrozen: wallet?.isFrozen || false,
    payoutSuspended: wallet?.payoutSuspended || false,
    frozenReason: wallet?.frozenReason || null,
  };
}

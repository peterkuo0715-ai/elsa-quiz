import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { money, ZERO } from "@/lib/money";
import { subDays, startOfDay, format } from "date-fns";

export async function getProjectedIncome(merchantId: string) {
  const [appreciation, shipped, pending] = await Promise.all([
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: "APPRECIATION_PERIOD" },
      select: { merchantReceivableAmount: true, appreciationPeriodEndAt: true },
    }),
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: { in: ["SHIPPED", "IN_TRANSIT"] } },
      select: { merchantReceivableAmount: true },
    }),
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: { in: ["EXPECTED_PROFIT", "PENDING_SHIPMENT"] } },
      select: { merchantReceivableAmount: true },
    }),
  ]);

  const appreciationTotal = appreciation.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);
  const shippedTotal = shipped.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);
  const pendingTotal = pending.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);

  let nearestEndDate: Date | null = null;
  for (const i of appreciation) {
    if (i.appreciationPeriodEndAt) {
      const d = new Date(i.appreciationPeriodEndAt);
      if (!nearestEndDate || d < nearestEndDate) nearestEndDate = d;
    }
  }

  return {
    total: appreciationTotal.plus(shippedTotal).plus(pendingTotal),
    appreciation: { count: appreciation.length, amount: appreciationTotal, nearestEndDate },
    shipped: { count: shipped.length, amount: shippedTotal },
    paid: { count: pending.length, amount: pendingTotal },
  };
}

export async function getDailyTrend(merchantId: string, days: number = 7) {
  const wallet = await prisma.merchantWallet.findUnique({ where: { merchantId } });
  if (!wallet) return [];

  const startDate = startOfDay(subDays(new Date(), days - 1));
  const entries = await prisma.walletLedgerEntry.findMany({
    where: { walletId: wallet.id, createdAt: { gte: startDate } },
    select: { amountTaxIncl: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const dailyMap = new Map<string, { income: typeof ZERO; deductions: typeof ZERO }>();
  for (let i = 0; i < days; i++) {
    dailyMap.set(format(subDays(new Date(), days - 1 - i), "MM/dd"), { income: ZERO, deductions: ZERO });
  }

  for (const entry of entries) {
    const date = format(new Date(entry.createdAt), "MM/dd");
    const current = dailyMap.get(date) || { income: ZERO, deductions: ZERO };
    const amount = money(entry.amountTaxIncl.toString());
    if (amount.isPositive()) current.income = current.income.plus(amount);
    else current.deductions = current.deductions.plus(amount.abs());
    dailyMap.set(date, current);
  }

  return Array.from(dailyMap.entries()).map(([date, data]) => ({
    date, income: Number(data.income.toFixed(0)), deductions: Number(data.deductions.toFixed(0)),
  }));
}

export async function getPendingActions(merchantId: string) {
  const [disputeCount, pendingBankChange, wallet] = await Promise.all([
    prisma.disputeCase.count({ where: { merchantId, status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } } }),
    prisma.merchantBankAccountChangeRequest.count({ where: { merchantId, status: "PENDING_REVIEW" } }),
    prisma.merchantWallet.findUnique({ where: { merchantId }, select: { isFrozen: true, payoutSuspended: true, frozenReason: true } }),
  ]);
  return {
    activeDisputes: disputeCount,
    pendingBankChange,
    isFrozen: wallet?.isFrozen || false,
    payoutSuspended: wallet?.payoutSuspended || false,
    frozenReason: wallet?.frozenReason || null,
  };
}

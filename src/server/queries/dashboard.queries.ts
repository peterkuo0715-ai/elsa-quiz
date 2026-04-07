import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { money, ZERO } from "@/lib/money";
import { subDays, startOfDay, format } from "date-fns";

export async function getProjectedIncome(merchantId: string) {
  // PRD v4: 4-layer pipeline — PAID → FULFILLMENT_COMPLETE → RETENTION_PERIOD → SETTLEABLE
  const [paid, fulfilled, retention, settleable] = await Promise.all([
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: "PAID" },
      select: { merchantReceivableAmount: true, paidAt: true },
    }),
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: "FULFILLMENT_COMPLETE" },
      select: { merchantReceivableAmount: true, fulfilledAt: true },
    }),
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: "RETENTION_PERIOD" },
      select: { merchantReceivableAmount: true, retentionEndAt: true },
    }),
    prisma.subOrder.findMany({
      where: { merchantId, subOrderStatus: "SETTLEABLE" },
      select: { merchantReceivableAmount: true, settleableAt: true },
    }),
  ]);

  const paidTotal = paid.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);
  const fulfilledTotal = fulfilled.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);
  const retentionTotal = retention.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);
  const settleableTotal = settleable.reduce((s, i) => s.plus(money(i.merchantReceivableAmount.toString())), ZERO);

  let nearestRetentionEnd: Date | null = null;
  for (const i of retention) {
    if (i.retentionEndAt) {
      const d = new Date(i.retentionEndAt);
      if (!nearestRetentionEnd || d < nearestRetentionEnd) nearestRetentionEnd = d;
    }
  }

  return {
    total: paidTotal.plus(fulfilledTotal).plus(retentionTotal).plus(settleableTotal),
    paid: { count: paid.length, amount: paidTotal },
    fulfilled: { count: fulfilled.length, amount: fulfilledTotal },
    retention: { count: retention.length, amount: retentionTotal, nearestRetentionEnd },
    settleable: { count: settleable.length, amount: settleableTotal },
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

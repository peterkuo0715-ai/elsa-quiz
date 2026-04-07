export const dynamic = "force-dynamic";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { moneyFormat, money, ZERO } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  Clock,
  Wallet,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import type Decimal from "decimal.js";

export default async function PlatformWalletsPage() {
  // ---------- wallets + balances ----------
  const wallets = await prisma.merchantWallet.findMany({
    include: { merchant: { select: { id: true, name: true, taxId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const TX = prisma as unknown as Parameters<typeof LedgerService.getBalances>[0];
  const walletsWithBalances = await Promise.all(
    wallets.map(async (w) => ({
      ...w,
      balances: await LedgerService.getBalances(TX, w.id),
    })),
  );

  // ---------- per-merchant SubOrder aggregations ----------
  const merchantIds = wallets.map((w) => w.merchant.id);

  const [commissionAgg, subOrderCounts, latestSubOrders] = await Promise.all([
    // aggregate commission & fee sums grouped by merchant
    prisma.subOrder.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: merchantIds } },
      _sum: {
        storeCommissionAmount: true,
        categoryCommissionAmount: true,
        estimatedPaymentFeeAmount: true,
      },
      _count: { id: true },
    }),
    // (count already included in groupBy above, but we keep structure clean)
    Promise.resolve(null),
    // latest SubOrder per merchant for rate display
    Promise.all(
      merchantIds.map((mid) =>
        prisma.subOrder.findFirst({
          where: { merchantId: mid },
          orderBy: { createdAt: "desc" },
          select: {
            storeCommissionRate: true,
            categoryCommissionRate: true,
          },
        }),
      ),
    ),
  ]);

  // build lookup maps
  const commissionMap = new Map(
    commissionAgg.map((row) => [
      row.merchantId,
      {
        storeCommission: money(row._sum.storeCommissionAmount ?? 0),
        categoryCommission: money(row._sum.categoryCommissionAmount ?? 0),
        paymentFee: money(row._sum.estimatedPaymentFeeAmount ?? 0),
        count: row._count.id,
      },
    ]),
  );

  const rateMap = new Map(
    merchantIds.map((mid, i) => [
      mid,
      latestSubOrders[i]
        ? {
            store: latestSubOrders[i]!.storeCommissionRate,
            category: latestSubOrders[i]!.categoryCommissionRate,
          }
        : null,
    ]),
  );

  // ---------- build enriched rows ----------
  const rows = walletsWithBalances.map((w) => {
    const c = commissionMap.get(w.merchant.id);
    const rates = rateMap.get(w.merchant.id);
    const totalCommission = c
      ? c.storeCommission.plus(c.categoryCommission)
      : ZERO;
    return {
      ...w,
      rates,
      totalCommission,
      paymentFee: c?.paymentFee ?? ZERO,
      subOrderCount: c?.count ?? 0,
    };
  });

  // ---------- platform-wide totals ----------
  const totals = rows.reduce(
    (acc, r) => ({
      pending: acc.pending.plus(r.balances.pending),
      available: acc.available.plus(r.balances.available),
      reserved: acc.reserved.plus(r.balances.reserved),
      inTransit: acc.inTransit.plus(r.balances.inTransit),
      totalCommission: acc.totalCommission.plus(r.totalCommission),
      paymentFee: acc.paymentFee.plus(r.paymentFee),
      subOrderCount: acc.subOrderCount + r.subOrderCount,
    }),
    {
      pending: ZERO as Decimal,
      available: ZERO as Decimal,
      reserved: ZERO as Decimal,
      inTransit: ZERO as Decimal,
      totalCommission: ZERO as Decimal,
      paymentFee: ZERO as Decimal,
      subOrderCount: 0,
    },
  );

  // commission revenue = total commissions across all SubOrders
  const platformCommissionRevenue = totals.totalCommission;

  // ---------- helpers ----------
  function rateDisplay(rates: { store: Decimal; category: Decimal } | null | undefined) {
    if (!rates) return <span className="text-xs text-muted-foreground">--</span>;
    const s = money(rates.store).times(100).toFixed(1);
    const c = money(rates.category).times(100).toFixed(1);
    return (
      <span className="text-xs tabular-nums">
        {s}% / {c}%
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">商家總帳管理</h2>
        <p className="text-muted-foreground">
          全平台 Wallet 總覽 &mdash; {rows.length} 間商家
        </p>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-amber-700">
              全平台待清款
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-900">
              {moneyFormat(totals.pending)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              尚未完成鑑賞期的款項
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">
              全平台可提領
            </CardTitle>
            <Wallet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-900">
              {moneyFormat(totals.available)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              商家可申請提領的總餘額
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-700">
              全平台 Reserve
            </CardTitle>
            <Shield className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-900">
              {moneyFormat(totals.reserved)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              保證金 / 爭議凍結款
            </p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-emerald-700">
              平台抽成收入
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-900">
              {moneyFormat(platformCommissionRevenue)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              店家抽成 + 品類抽成累計
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Merchant Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">各商家帳戶明細</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[140px]">商家名</TableHead>
                  <TableHead className="text-center min-w-[90px]">費率</TableHead>
                  <TableHead className="text-right min-w-[110px]">待清款</TableHead>
                  <TableHead className="text-right min-w-[110px]">可提領</TableHead>
                  <TableHead className="text-right min-w-[100px]">Reserve</TableHead>
                  <TableHead className="text-right min-w-[100px]">提領中</TableHead>
                  <TableHead className="text-right min-w-[110px]">累計抽成</TableHead>
                  <TableHead className="text-right min-w-[110px]">累計金流費</TableHead>
                  <TableHead className="text-right min-w-[70px]">子單數</TableHead>
                  <TableHead className="min-w-[80px]">狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.merchant.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.merchant.taxId}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {rateDisplay(r.rates)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {moneyFormat(r.balances.pending)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums font-medium text-green-600">
                      {moneyFormat(r.balances.available)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-blue-600">
                      {moneyFormat(r.balances.reserved)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-purple-600">
                      {moneyFormat(r.balances.inTransit)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-emerald-600">
                      {moneyFormat(r.totalCommission)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-orange-600">
                      {moneyFormat(r.paymentFee)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.subOrderCount}
                    </TableCell>
                    <TableCell>
                      {r.isFrozen && (
                        <Badge className="bg-red-100 text-red-800 border-0">
                          凍結
                        </Badge>
                      )}
                      {r.payoutSuspended && !r.isFrozen && (
                        <Badge className="bg-orange-100 text-orange-800 border-0">
                          停提領
                        </Badge>
                      )}
                      {!r.isFrozen && !r.payoutSuspended && (
                        <span className="text-xs text-green-600">正常</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell>
                    合計（{rows.length} 間）
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right text-sm tabular-nums">
                    {moneyFormat(totals.pending)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-green-700">
                    {moneyFormat(totals.available)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-blue-700">
                    {moneyFormat(totals.reserved)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-purple-700">
                    {moneyFormat(totals.inTransit)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-emerald-700">
                    {moneyFormat(totals.totalCommission)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-orange-700">
                    {moneyFormat(totals.paymentFee)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {totals.subOrderCount}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWalletBalances, getRecentLedgerEntries } from "@/server/queries/wallet.queries";
import { getProjectedIncome, getDailyTrend, getPendingActions } from "@/server/queries/dashboard.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { TrendChart } from "@/components/trend-chart";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from "next/link";
import {
  Wallet,
  Clock,
  Shield,
  Truck,
  TrendingUp,
  ArrowRight,
  AlertTriangle,
  Ban,
  Lock,
  Package,
  CalendarClock,
  CreditCard,
} from "lucide-react";

export default async function MerchantDashboard() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const merchantId = session.user.merchantId;

  const [balances, projected, trend7, trend30, pending, recentEntries] =
    await Promise.all([
      getWalletBalances(merchantId),
      getProjectedIncome(merchantId),
      getDailyTrend(merchantId, 7),
      getDailyTrend(merchantId, 30),
      getPendingActions(merchantId),
      getRecentLedgerEntries(merchantId, 10),
    ]);

  const alerts: Array<{ icon: typeof AlertTriangle; message: string; type: "error" | "warning" }> = [];
  if (pending.payoutSuspended) {
    alerts.push({ icon: Ban, message: "因負餘額已暫停提領，請等待餘額回正後再申請", type: "error" });
  }
  if (pending.isFrozen) {
    alerts.push({ icon: Lock, message: `錢包已被凍結${pending.frozenReason ? `：${pending.frozenReason}` : ""}`, type: "error" });
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 rounded-lg p-3 ${
            alert.type === "error"
              ? "border border-red-200 bg-red-50 text-red-800"
              : "border border-yellow-200 bg-yellow-50 text-yellow-800"
          }`}
        >
          <alert.icon className="h-4 w-4 shrink-0" />
          <span className="text-sm">{alert.message}</span>
        </div>
      ))}

      {/* ===== Layer 1: Hero - Available Balance ===== */}
      <div className="grid gap-4 lg:grid-cols-4">
        {/* Main: Available Balance */}
        <Card className="lg:col-span-2 bg-gradient-to-br from-green-50 to-white border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-green-700">可提領餘額</p>
                <p className="mt-2 text-4xl font-bold tracking-tight text-green-900">
                  {moneyFormat(balances.available)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  扣除 Reserve 與凍結後可提領金額
                </p>
              </div>
              <Wallet className="h-8 w-8 text-green-400" />
            </div>
            <div className="mt-4">
              <Link href="/payouts">
                <Button size="sm" className="bg-green-600 hover:bg-green-700">
                  立即提領
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Sub cards */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">待清款</p>
              <Clock className="h-4 w-4 text-yellow-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">{moneyFormat(balances.pending)}</p>
            <p className="mt-1 text-xs text-muted-foreground">已付款未過鑑賞期</p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Reserve</p>
                <Shield className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <p className="mt-1 text-lg font-bold">{moneyFormat(balances.reserved)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">提領中</p>
                <Truck className="h-3.5 w-3.5 text-purple-500" />
              </div>
              <p className="mt-1 text-lg font-bold">{moneyFormat(balances.inTransit)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===== Layer 2: Projected Income ===== */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              預計入帳
            </CardTitle>
            <span className="text-2xl font-bold">{moneyFormat(projected.total)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            {/* L1: 已付款 */}
            <div className="rounded-lg border bg-blue-50/50 p-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">已付款</span>
              </div>
              <p className="mt-2 text-xl font-bold">{moneyFormat(projected.paid.amount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{projected.paid.count} 筆・預計值</p>
            </div>

            {/* L2: 已履約 */}
            <div className="rounded-lg border bg-cyan-50/50 p-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-medium">已履約</span>
              </div>
              <p className="mt-2 text-xl font-bold">{moneyFormat(projected.fulfilled.amount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{projected.fulfilled.count} 筆・預計值</p>
            </div>

            {/* L3: 保留期中 */}
            <div className="rounded-lg border bg-yellow-50/50 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium">保留期中</span>
              </div>
              <p className="mt-2 text-xl font-bold">{moneyFormat(projected.retention.amount)}</p>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{projected.retention.count} 筆・預計值</span>
                {projected.retention.nearestRetentionEnd && (
                  <span>
                    最近到期: {format(projected.retention.nearestRetentionEnd, "MM/dd", { locale: zhTW })}
                  </span>
                )}
              </div>
            </div>

            {/* L4: 可結算 */}
            <div className="rounded-lg border bg-green-50/50 p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">可結算</span>
              </div>
              <p className="mt-2 text-xl font-bold">{moneyFormat(projected.settleable.amount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{projected.settleable.count} 筆・確認值</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Layer 3: Trend Chart ===== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">收入趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart data7={trend7} data30={trend30} />
        </CardContent>
      </Card>

      {/* ===== Layer 4: Quick Actions + Pending ===== */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/payouts">
          <Card className="cursor-pointer transition-colors hover:bg-green-50 h-full">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-green-100 p-2">
                <Wallet className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium">立即提領</p>
                <p className="text-xs text-muted-foreground">申請提領款項</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/disputes">
          <Card className={`cursor-pointer transition-colors hover:bg-orange-50 h-full ${pending.activeDisputes > 0 ? "border-orange-300" : ""}`}>
            <CardContent className="flex items-center gap-3 pt-6">
              <div className={`rounded-lg p-2 ${pending.activeDisputes > 0 ? "bg-orange-100" : "bg-gray-100"}`}>
                <AlertTriangle className={`h-5 w-5 ${pending.activeDisputes > 0 ? "text-orange-600" : "text-gray-400"}`} />
              </div>
              <div>
                <p className="text-sm font-medium">爭議案件</p>
                <p className="text-xs text-muted-foreground">
                  {pending.activeDisputes > 0
                    ? `${pending.activeDisputes} 件待處理`
                    : "無待處理"}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/bank-accounts">
          <Card className={`cursor-pointer transition-colors hover:bg-blue-50 h-full ${pending.pendingBankChange > 0 ? "border-blue-300" : ""}`}>
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-blue-100 p-2">
                <CreditCard className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium">銀行帳號</p>
                <p className="text-xs text-muted-foreground">
                  {pending.pendingBankChange > 0
                    ? `${pending.pendingBankChange} 件審核中`
                    : "帳號管理"}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/reconciliation">
          <Card className="cursor-pointer transition-colors hover:bg-purple-50 h-full">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-purple-100 p-2">
                <Package className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium">對帳明細</p>
                <p className="text-xs text-muted-foreground">查看結算紀錄</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ===== Layer 5: Recent Ledger Timeline ===== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">最近帳務事件</CardTitle>
        </CardHeader>
        <CardContent>
          <LedgerTimeline
            entries={recentEntries.map((e) => ({
              id: e.id,
              entryType: e.entryType,
              bucket: e.bucket,
              amount: e.amount.toString(),
              amountTaxIncl: e.amountTaxIncl.toString(),
              amountTaxExcl: e.amountTaxExcl.toString(),
              balanceAfter: e.balanceAfter.toString(),
              description: e.description,
              createdAt: e.createdAt,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWalletDashboardData } from "@/server/queries/wallet.queries";
import { getRecentLedgerEntries } from "@/server/queries/wallet.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletSummaryCard } from "@/components/wallet-summary-card";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { moneyFormat } from "@/lib/money";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Ban,
  Lock,
} from "lucide-react";

export default async function MerchantDashboard() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const dashboardData = await getWalletDashboardData(
    session.user.merchantId
  );
  const recentEntries = await getRecentLedgerEntries(
    session.user.merchantId,
    10
  );

  const { balances, monthlyIncome, monthlyDeductions, monthlyNet } =
    dashboardData;

  const alerts: { icon: typeof AlertTriangle; message: string; color: string }[] = [];
  if (balances.payoutSuspended) {
    alerts.push({
      icon: Ban,
      message: "因負餘額已暫停提領，請等待餘額回正後再申請",
      color: "text-red-500",
    });
  }
  if (balances.isFrozen) {
    alerts.push({
      icon: Lock,
      message: `錢包已被凍結${balances.frozenReason ? `：${balances.frozenReason}` : ""}`,
      color: "text-red-500",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">帳務總覽</h2>
        <p className="text-muted-foreground">
          歡迎回來，{session.user.name}
        </p>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3"
            >
              <alert.icon className={`h-4 w-4 ${alert.color}`} />
              <span className="text-sm text-red-800">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Wallet Buckets */}
      <WalletSummaryCard
        balances={{
          pending: balances.pending.toString(),
          available: balances.available.toString(),
          reserved: balances.reserved.toString(),
          inTransit: balances.inTransit.toString(),
        }}
      />

      {/* Monthly Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月總收入</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {moneyFormat(monthlyIncome)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月總扣款</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {moneyFormat(monthlyDeductions)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">本月淨入帳</CardTitle>
            <DollarSign className="h-4 w-4 text-gray-900" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {moneyFormat(monthlyNet)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Ledger Entries */}
      <Card>
        <CardHeader>
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

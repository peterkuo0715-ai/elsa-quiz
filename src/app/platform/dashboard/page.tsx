import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { moneyFormat, money, ZERO } from "@/lib/money";
import { Users, Wallet, AlertTriangle, Banknote, Calculator, Clock, Shield } from "lucide-react";

export default async function PlatformDashboard() {
  const [
    merchantCount,
    pendingPayouts,
    activeDisputes,
    frozenWallets,
    pendingSettlements,
    pendingBankChanges,
  ] = await Promise.all([
    prisma.merchant.count({ where: { isActive: true } }),
    prisma.payoutRequest.count({ where: { status: "REQUESTED" } }),
    prisma.disputeCase.count({
      where: {
        status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] },
      },
    }),
    prisma.merchantWallet.count({ where: { isFrozen: true } }),
    prisma.subOrder.count({
      where: {
        subOrderStatus: "APPRECIATION_PERIOD",
        appreciationPeriodEndAt: { lte: new Date() },
      },
    }),
    prisma.merchantBankAccountChangeRequest.count({
      where: { status: "PENDING_REVIEW" },
    }),
  ]);

  // Total available across all wallets
  const wallets = await prisma.merchantWallet.findMany();
  // For simplicity, we show wallet count; real totals come from ledger

  const stats = [
    { label: "總商家數", value: merchantCount.toString(), icon: Users, color: "text-blue-600" },
    { label: "待處理提領", value: pendingPayouts.toString(), icon: Banknote, color: "text-yellow-600" },
    { label: "活躍爭議", value: activeDisputes.toString(), icon: AlertTriangle, color: "text-orange-600" },
    { label: "待結算項目", value: pendingSettlements.toString(), icon: Calculator, color: "text-purple-600" },
    { label: "凍結錢包", value: frozenWallets.toString(), icon: Shield, color: "text-red-600" },
    { label: "待審帳號變更", value: pendingBankChanges.toString(), icon: Clock, color: "text-yellow-600" },
  ];

  // Recent audit logs
  const recentAudits = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">平台財務總覽</h2>
        <p className="text-muted-foreground">平台帳務管理總覽</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近操作紀錄</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAudits.length === 0 ? (
            <p className="text-sm text-muted-foreground">無紀錄</p>
          ) : (
            <div className="space-y-2">
              {recentAudits.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between rounded border p-2 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {log.action}
                    </span>
                    <span className="mx-2 text-muted-foreground">-</span>
                    <span>{log.user?.name || "System"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString("zh-TW")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

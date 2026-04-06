export const dynamic = "force-dynamic";
import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ReserveManagementPanel } from "./reserve-management-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const RISK_COLORS: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-red-100 text-red-800",
};

const RISK_LABELS: Record<string, string> = {
  LOW: "低風險",
  MEDIUM: "中風險",
  HIGH: "高風險",
};

export default async function ReservesPage() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    include: {
      riskProfile: true,
      reserveRules: { where: { isActive: true }, take: 1 },
      wallet: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Reserve 管理</h2>
        <p className="text-muted-foreground">設定商家風險等級與保留金規則</p>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商家</TableHead>
              <TableHead>風險等級</TableHead>
              <TableHead>Reserve 比例</TableHead>
              <TableHead>保留天數</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {merchants.map((m) => {
              const riskLevel = m.riskProfile?.riskLevel || "LOW";
              const rule = m.reserveRules[0];
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(RISK_COLORS[riskLevel], "border-0")}
                    >
                      {RISK_LABELS[riskLevel]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {rule
                      ? `${(Number(rule.reservePercent.toString()) * 100).toFixed(1)}%`
                      : "未設定"}
                  </TableCell>
                  <TableCell>
                    {rule ? `${rule.holdDays} 天` : "-"}
                  </TableCell>
                  <TableCell>
                    <ReserveManagementPanel
                      merchantId={m.id}
                      merchantName={m.name}
                      currentRiskLevel={riskLevel}
                      currentReservePercent={rule?.reservePercent.toString()}
                      currentHoldDays={rule?.holdDays}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

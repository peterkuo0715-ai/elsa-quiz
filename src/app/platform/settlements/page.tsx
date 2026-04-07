export const dynamic = "force-dynamic";
import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  EXPECTED: { label: "預計值", color: "bg-yellow-100 text-yellow-800" },
  AVAILABLE: { label: "可結算", color: "bg-green-100 text-green-800" },
  SETTLED: { label: "已結算", color: "bg-blue-100 text-blue-800" },
  SETTLEABLE: { label: "可結算", color: "bg-green-100 text-green-800" },
  PAYOUT_PENDING: { label: "待撥款", color: "bg-cyan-100 text-cyan-800" },
  ESTIMATED: { label: "預計值", color: "bg-yellow-100 text-yellow-800" },
};

const SUB_ORDER_STATUS_MAP: Record<string, { label: string; color: string }> = {
  PAID: { label: "已付款", color: "bg-blue-100 text-blue-800" },
  FULFILLMENT_COMPLETE: { label: "已履約", color: "bg-cyan-100 text-cyan-800" },
  RETENTION_PERIOD: { label: "保留期中", color: "bg-yellow-100 text-yellow-800" },
  SETTLEABLE: { label: "可結算", color: "bg-green-100 text-green-800" },
  SETTLED: { label: "已撥款", color: "bg-emerald-100 text-emerald-800" },
  DISPUTED: { label: "爭議中", color: "bg-purple-100 text-purple-800" },
  CANCELLED: { label: "已取消", color: "bg-red-100 text-red-800" },
};

export default async function SettlementsPage() {
  const [subOrders, pipelineCounts] = await Promise.all([
    prisma.subOrder.findMany({
      include: { merchant: { select: { name: true } }, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    Promise.all([
      prisma.subOrder.count({ where: { subOrderStatus: "PAID" } }),
      prisma.subOrder.count({ where: { subOrderStatus: "FULFILLMENT_COMPLETE" } }),
      prisma.subOrder.count({ where: { subOrderStatus: "RETENTION_PERIOD" } }),
      prisma.subOrder.count({ where: { subOrderStatus: "SETTLEABLE" } }),
      prisma.subOrder.count({ where: { subOrderStatus: "SETTLED" } }),
    ]),
  ]);

  const [paidCount, fulfilledCount, retentionCount, settleableCount, settledCount] = pipelineCounts;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">結算管理</h2>
        <p className="text-muted-foreground">PRD v4 四層時間分離結算管線</p>
      </div>

      {/* Pipeline Overview */}
      <div className="grid gap-3 md:grid-cols-5">
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-blue-600">💳 已付款</p>
            <p className="mt-1 text-2xl font-bold">{paidCount}</p>
            <p className="text-xs text-muted-foreground">預計值</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-200 bg-cyan-50/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-cyan-600">🚚 已履約</p>
            <p className="mt-1 text-2xl font-bold">{fulfilledCount}</p>
            <p className="text-xs text-muted-foreground">預計值</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 bg-yellow-50/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-yellow-600">⏳ 保留期中</p>
            <p className="mt-1 text-2xl font-bold">{retentionCount}</p>
            <p className="text-xs text-muted-foreground">預計值（7天）</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-green-600">✅ 可結算</p>
            <p className="mt-1 text-2xl font-bold">{settleableCount}</p>
            <p className="text-xs text-muted-foreground">確認值</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-emerald-600">💰 已撥款</p>
            <p className="mt-1 text-2xl font-bold">{settledCount}</p>
            <p className="text-xs text-muted-foreground">已完成</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訂單編號</TableHead>
              <TableHead>商家</TableHead>
              <TableHead>子單狀態</TableHead>
              <TableHead>金額狀態</TableHead>
              <TableHead className="text-right">商家應得</TableHead>
              <TableHead className="text-right">抽成</TableHead>
              <TableHead className="text-right">金流費</TableHead>
              <TableHead>收單時間</TableHead>
              <TableHead>可結算時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subOrders.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="h-24 text-center">無資料</TableCell></TableRow>
            ) : (
              subOrders.map((so) => {
                const d = so as Record<string, unknown>;
                const subStatus = SUB_ORDER_STATUS_MAP[so.subOrderStatus] || { label: so.subOrderStatus, color: "bg-gray-100" };
                const settStatus = STATUS_MAP[so.settlementStatus] || { label: so.settlementStatus, color: "bg-gray-100" };
                const totalComm = Number(so.storeCommissionAmount.toString()) + Number(so.categoryCommissionAmount.toString());
                const isConfirmed = d.isAmountConfirmed as boolean;
                return (
                  <TableRow key={so.id}>
                    <TableCell className="font-mono text-xs">{so.order.orderNumber}</TableCell>
                    <TableCell className="text-sm">{so.merchant.name}</TableCell>
                    <TableCell><Badge variant="outline" className={cn(subStatus.color, "border-0")}>{subStatus.label}</Badge></TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        isConfirmed ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600",
                        "border-0 text-xs"
                      )}>
                        {isConfirmed ? "確認值" : "預計值"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {!isConfirmed && <span className="text-gray-400 text-xs mr-1">~</span>}
                      {moneyFormat(so.merchantReceivableAmount.toString())}
                    </TableCell>
                    <TableCell className="text-right text-sm text-red-600">-{totalComm}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">-{so.estimatedPaymentFeeAmount.toString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.paidAt ? format(new Date(d.paidAt as string), "MM/dd HH:mm", { locale: zhTW }) : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.settleableAt ? format(new Date(d.settleableAt as string), "MM/dd HH:mm", { locale: zhTW })
                        : d.retentionEndAt ? <span className="text-yellow-600">保留至 {format(new Date(d.retentionEndAt as string), "MM/dd", { locale: zhTW })}</span>
                        : "-"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

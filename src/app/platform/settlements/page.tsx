import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  EXPECTED: { label: "可預期", color: "bg-yellow-100 text-yellow-800" },
  AVAILABLE: { label: "可結算", color: "bg-green-100 text-green-800" },
  SETTLED: { label: "已結算", color: "bg-blue-100 text-blue-800" },
};

export default async function SettlementsPage() {
  const [subOrders, pendingCount] = await Promise.all([
    prisma.subOrder.findMany({
      include: { merchant: { select: { name: true } }, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.subOrder.count({
      where: { subOrderStatus: "APPRECIATION_PERIOD", appreciationPeriodEndAt: { lte: new Date() } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">結算管理</h2>
        <p className="text-muted-foreground">子單結算狀態一覽（v2 架構）</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">待結算子單</CardTitle></CardHeader>
        <CardContent><div className="text-3xl font-bold">{pendingCount} 筆</div></CardContent>
      </Card>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訂單編號</TableHead>
              <TableHead>商家</TableHead>
              <TableHead>結算狀態</TableHead>
              <TableHead className="text-right">商家應得</TableHead>
              <TableHead className="text-right">抽成</TableHead>
              <TableHead className="text-right">金流費</TableHead>
              <TableHead>建立時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subOrders.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center">無資料</TableCell></TableRow>
            ) : (
              subOrders.map((so) => {
                const s = STATUS_MAP[so.settlementStatus] || { label: so.settlementStatus, color: "bg-gray-100" };
                const totalComm = Number(so.storeCommissionAmount.toString()) + Number(so.categoryCommissionAmount.toString());
                return (
                  <TableRow key={so.id}>
                    <TableCell className="font-mono text-xs">{so.order.orderNumber}</TableCell>
                    <TableCell className="text-sm">{so.merchant.name}</TableCell>
                    <TableCell><Badge variant="outline" className={cn(s.color, "border-0")}>{s.label}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{moneyFormat(so.merchantReceivableAmount.toString())}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">-{totalComm}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">-{so.estimatedPaymentFeeAmount.toString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(so.createdAt), "MM/dd HH:mm", { locale: zhTW })}</TableCell>
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

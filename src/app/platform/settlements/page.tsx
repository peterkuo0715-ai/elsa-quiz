import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { RunSettlementButton } from "./run-settlement-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: "待處理", color: "bg-yellow-100 text-yellow-800" },
  PROCESSING: { label: "處理中", color: "bg-blue-100 text-blue-800" },
  COMPLETED: { label: "完成", color: "bg-green-100 text-green-800" },
  FAILED: { label: "失敗", color: "bg-red-100 text-red-800" },
};

export default async function SettlementsPage() {
  const [batches, pendingCount] = await Promise.all([
    prisma.settlementBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.settlementItem.count({
      where: {
        status: "IN_APPRECIATION_PERIOD",
        appreciationEndsAt: { lte: new Date() },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">結算批次管理</h2>
        <p className="text-muted-foreground">執行與查看結算批次</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">待結算項目</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingCount} 筆</div>
            <p className="text-xs text-muted-foreground">鑑賞期已到期，等待結算</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">執行結算</CardTitle>
          </CardHeader>
          <CardContent>
            <RunSettlementButton pendingCount={pendingCount} />
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>批次編號</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">總筆數</TableHead>
              <TableHead className="text-right">總金額</TableHead>
              <TableHead className="text-right">成功</TableHead>
              <TableHead className="text-right">失敗</TableHead>
              <TableHead>觸發者</TableHead>
              <TableHead>建立時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  無批次紀錄
                </TableCell>
              </TableRow>
            ) : (
              batches.map((b) => {
                const statusInfo = STATUS_MAP[b.status] || {
                  label: b.status,
                  color: "bg-gray-100",
                };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.batchNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(statusInfo.color, "border-0")}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{b.totalItems}</TableCell>
                    <TableCell className="text-right font-medium">
                      {moneyFormat(b.totalAmount.toString())}
                    </TableCell>
                    <TableCell className="text-right text-green-600">{b.successCount}</TableCell>
                    <TableCell className="text-right text-red-600">{b.failedCount}</TableCell>
                    <TableCell className="text-xs">{b.triggeredBy || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(b.createdAt), "MM/dd HH:mm", { locale: zhTW })}
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

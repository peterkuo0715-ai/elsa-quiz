import { getPayoutBatches, getPendingPayoutRequests } from "@/server/queries/payout.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { CreateBatchButton } from "./create-batch-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const BATCH_STATUS: Record<string, { label: string; color: string }> = {
  CREATED: { label: "已建立", color: "bg-yellow-100 text-yellow-800" },
  EXPORTED: { label: "已匯出", color: "bg-blue-100 text-blue-800" },
  PROCESSING: { label: "處理中", color: "bg-blue-100 text-blue-800" },
  COMPLETED: { label: "完成", color: "bg-green-100 text-green-800" },
  PARTIALLY_FAILED: { label: "部分失敗", color: "bg-orange-100 text-orange-800" },
};

export default async function PlatformPayoutsPage() {
  const [pendingRequests, batches] = await Promise.all([
    getPendingPayoutRequests(),
    getPayoutBatches(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">提領批次管理</h2>
        <p className="text-muted-foreground">管理提領批次與銀行回檔</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">待處理提領</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingRequests.length} 筆</div>
            <p className="text-sm text-muted-foreground">等待建立批次</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">建立新批次</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateBatchButton pendingCount={pendingRequests.length} />
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>批次編號</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">筆數</TableHead>
              <TableHead className="text-right">總金額</TableHead>
              <TableHead className="text-right">成功</TableHead>
              <TableHead className="text-right">失敗</TableHead>
              <TableHead>建立時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  無批次紀錄
                </TableCell>
              </TableRow>
            ) : (
              batches.items.map((batch) => {
                const statusInfo = BATCH_STATUS[batch.status] || {
                  label: batch.status,
                  color: "bg-gray-100 text-gray-800",
                };
                return (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono text-xs">
                      {batch.batchNumber}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(statusInfo.color, "border-0")}>
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{batch.totalItems}</TableCell>
                    <TableCell className="text-right font-medium">
                      {moneyFormat(batch.totalAmount.toString())}
                    </TableCell>
                    <TableCell className="text-right text-green-600">{batch.successCount}</TableCell>
                    <TableCell className="text-right text-red-600">{batch.failedCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(batch.createdAt), "MM/dd HH:mm", { locale: zhTW })}
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

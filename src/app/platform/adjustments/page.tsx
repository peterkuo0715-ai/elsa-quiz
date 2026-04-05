import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdjustmentForm } from "./adjustment-form";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TYPE_LABELS: Record<string, string> = {
  SUPPLEMENTARY_PAYMENT: "補發",
  CLAWBACK: "扣回",
  COMPLAINT_COMPENSATION: "客訴補償",
  DISCREPANCY_CORRECTION: "帳差修正",
  TAX_ADJUSTMENT: "稅務調整",
  SYSTEM_CORRECTION: "系統修正",
};

export default async function AdjustmentsPage() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const adjustments = await prisma.settlementAdjustment.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">手動調整單</h2>
        <p className="text-muted-foreground">建立與管理手動調整</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">建立調整單</CardTitle>
        </CardHeader>
        <CardContent>
          <AdjustmentForm
            merchants={merchants.map((m) => ({ id: m.id, name: m.name }))}
          />
        </CardContent>
      </Card>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>類型</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>原因</TableHead>
              <TableHead>建立時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  無調整紀錄
                </TableCell>
              </TableRow>
            ) : (
              adjustments.map((adj) => {
                const isCredit = Number(adj.amountTaxIncl.toString()) > 0;
                return (
                  <TableRow key={adj.id}>
                    <TableCell>
                      <Badge variant="outline" className="border-0 bg-gray-100">
                        {TYPE_LABELS[adj.adjustmentType] || adj.adjustmentType}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        isCredit ? "text-green-600" : "text-red-600"
                      )}
                    >
                      {isCredit ? "+" : ""}
                      {moneyFormat(adj.amountTaxIncl.toString())}
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">
                      {adj.reason}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(adj.createdAt), "MM/dd HH:mm", {
                        locale: zhTW,
                      })}
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

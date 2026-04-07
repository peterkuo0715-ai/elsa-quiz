import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReconciliationList } from "@/server/queries/reconciliation.queries";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  // 舊狀態（相容）
  EXPECTED_PROFIT: { label: "可預期獲利", color: "bg-yellow-100 text-yellow-800" },
  PENDING_SHIPMENT: { label: "待出貨", color: "bg-yellow-100 text-yellow-800" },
  SHIPPED: { label: "已出貨", color: "bg-blue-100 text-blue-800" },
  IN_TRANSIT: { label: "運送中", color: "bg-blue-100 text-blue-800" },
  DELIVERED: { label: "已送達", color: "bg-blue-100 text-blue-800" },
  APPRECIATION_PERIOD: { label: "鑑賞期中", color: "bg-yellow-100 text-yellow-800" },
  // PRD v4 新狀態
  PAID: { label: "已付款", color: "bg-blue-100 text-blue-800" },
  FULFILLMENT_COMPLETE: { label: "已履約", color: "bg-cyan-100 text-cyan-800" },
  RETENTION_PERIOD: { label: "保留期中", color: "bg-yellow-100 text-yellow-800" },
  SETTLEABLE: { label: "可結算", color: "bg-green-100 text-green-800" },
  SETTLED: { label: "已撥款", color: "bg-emerald-100 text-emerald-800" },
  DISPUTED: { label: "爭議中", color: "bg-purple-100 text-purple-800" },
  CANCELLED: { label: "已取消", color: "bg-red-100 text-red-800" },
};

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const data = await getReconciliationList({ merchantId: session.user.merchantId });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">對帳明細</h2>
        <p className="text-muted-foreground">以子單為單位的帳務明細（PRD v4 四層時間分離）</p>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訂單編號</TableHead>
              <TableHead>商品</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>金額狀態</TableHead>
              <TableHead className="text-right">商家應得</TableHead>
              <TableHead className="text-right">抽成</TableHead>
              <TableHead className="text-right">金流費</TableHead>
              <TableHead>收單時間</TableHead>
              <TableHead>可結算時間</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center">無資料，請先在 POC 模擬器建立訂單</TableCell>
              </TableRow>
            ) : (
              data.items.map((so) => {
                const status = STATUS_MAP[so.subOrderStatus] || { label: so.subOrderStatus, color: "bg-gray-100" };
                const products = so.items.map((i) => i.orderItem.productName).join(" + ");
                const isConfirmed = (so as Record<string, unknown>).isAmountConfirmed as boolean;
                return (
                  <TableRow key={so.id}>
                    <TableCell>
                      <Link href={`/reconciliation/${so.id}`} className="text-blue-600 hover:underline text-xs font-mono">
                        {so.order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">{products}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(status.color, "border-0")}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        isConfirmed ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600",
                        "border-0 text-xs"
                      )}>
                        {isConfirmed ? "確認值" : "預計值"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {!isConfirmed && <span className="text-gray-400 text-xs mr-1">~</span>}
                      {moneyFormat(so.merchantReceivableAmount.toString())}
                    </TableCell>
                    <TableCell className="text-right text-sm text-red-600">
                      -{so.storeCommissionAmount.toString()}
                      {Number(so.categoryCommissionAmount.toString()) > 0 && ` / -${so.categoryCommissionAmount.toString()}`}
                    </TableCell>
                    <TableCell className="text-right text-sm text-red-600">-{so.estimatedPaymentFeeAmount.toString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(so as Record<string, unknown>).paidAt ? format(new Date((so as Record<string, unknown>).paidAt as string), "MM/dd HH:mm", { locale: zhTW }) : so.order.paidAt ? format(new Date(so.order.paidAt), "MM/dd HH:mm", { locale: zhTW }) : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(so as Record<string, unknown>).settleableAt ? format(new Date((so as Record<string, unknown>).settleableAt as string), "MM/dd HH:mm", { locale: zhTW }) : (so as Record<string, unknown>).retentionEndAt ? <span className="text-yellow-600">保留至 {format(new Date((so as Record<string, unknown>).retentionEndAt as string), "MM/dd", { locale: zhTW })}</span> : "-"}
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

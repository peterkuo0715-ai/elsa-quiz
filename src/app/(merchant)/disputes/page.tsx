import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMerchantDisputes } from "@/server/queries/dispute.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { AlertTriangle, Lock, CheckCircle, XCircle } from "lucide-react";
import { DisputeEvidenceForm } from "./dispute-evidence-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  OPENED: { label: "已開案", color: "bg-orange-100 text-orange-800" },
  WAITING_MERCHANT_RESPONSE: { label: "等待商家回覆", color: "bg-yellow-100 text-yellow-800" },
  WAITING_PLATFORM_REVIEW: { label: "平台審核中", color: "bg-blue-100 text-blue-800" },
  EVIDENCE_PENDING: { label: "待補件", color: "bg-yellow-100 text-yellow-800" },
  PARTIALLY_FROZEN: { label: "部分凍結", color: "bg-purple-100 text-purple-800" },
  RESOLVED: { label: "已解決", color: "bg-green-100 text-green-800" },
  REJECTED: { label: "已駁回", color: "bg-red-100 text-red-800" },
  CLOSED: { label: "已結案", color: "bg-gray-100 text-gray-800" },
};

export default async function DisputesPage() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const disputes = await getMerchantDisputes({
    merchantId: session.user.merchantId,
  });

  const activeCount = disputes.items.filter(
    (d) => !["RESOLVED", "REJECTED", "CLOSED"].includes(d.status)
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">爭議案件</h2>
        <p className="text-muted-foreground">查看與管理爭議案件</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">進行中案件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">全部案件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{disputes.total}</div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>案件編號</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>爭議原因</TableHead>
              <TableHead className="text-right">爭議金額</TableHead>
              <TableHead>凍結狀態</TableHead>
              <TableHead>開案時間</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disputes.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  無爭議案件
                </TableCell>
              </TableRow>
            ) : (
              disputes.items.map((d) => {
                const statusInfo = STATUS_MAP[d.status] || {
                  label: d.status,
                  color: "bg-gray-100",
                };
                const hasFrozen = d.freezes.length > 0;
                const canSubmitEvidence = [
                  "OPENED",
                  "WAITING_MERCHANT_RESPONSE",
                  "EVIDENCE_PENDING",
                ].includes(d.status);

                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">
                      {d.caseNumber}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(statusInfo.color, "border-0")}
                      >
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {d.disputeReason}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {moneyFormat(d.disputeAmountTaxIncl.toString())}
                    </TableCell>
                    <TableCell>
                      {hasFrozen ? (
                        <span className="flex items-center gap-1 text-xs text-purple-600">
                          <Lock className="h-3 w-3" />
                          已凍結
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(d.openedAt), "MM/dd HH:mm", {
                        locale: zhTW,
                      })}
                    </TableCell>
                    <TableCell>
                      {canSubmitEvidence && (
                        <DisputeEvidenceForm disputeId={d.id} />
                      )}
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

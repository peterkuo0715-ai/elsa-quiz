"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { moneyFormat } from "@/lib/money";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: "已申請", color: "bg-yellow-100 text-yellow-800" },
  QUEUED: { label: "排隊中", color: "bg-yellow-100 text-yellow-800" },
  PROCESSING: { label: "處理中", color: "bg-blue-100 text-blue-800" },
  SUCCESS: { label: "成功", color: "bg-green-100 text-green-800" },
  FAILED: { label: "失敗", color: "bg-red-100 text-red-800" },
  RETURNED: { label: "已退回", color: "bg-red-100 text-red-800" },
};

interface PayoutItem {
  id: string;
  requestNumber: string;
  amountTaxIncl: { toString(): string };
  status: string;
  bankNameSnapshot: string;
  accountNumberSnapshot: string;
  accountNameSnapshot: string;
  requestedAt: Date | string;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
  failures: Array<{ failureReason: string; occurredAt: Date | string }>;
  batchItems: Array<{ batch: { batchNumber: string } }>;
}

interface Props {
  items: PayoutItem[];
  total: number;
  page: number;
  totalPages: number;
}

export function PayoutHistoryTable({ items, total, page, totalPages }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", p.toString());
    router.push(`/payouts?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>申請編號</TableHead>
              <TableHead>金額</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>銀行帳號</TableHead>
              <TableHead>批次</TableHead>
              <TableHead>申請時間</TableHead>
              <TableHead>完成/失敗時間</TableHead>
              <TableHead>備註</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  無提領紀錄
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const statusInfo = STATUS_MAP[item.status] || {
                  label: item.status,
                  color: "bg-gray-100 text-gray-800",
                };
                const lastFailure = item.failures[0];

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.requestNumber}
                    </TableCell>
                    <TableCell className="font-medium">
                      {moneyFormat(item.amountTaxIncl.toString())}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(statusInfo.color, "border-0")}
                      >
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.bankNameSnapshot} ...
                      {item.accountNumberSnapshot.slice(-4)}
                      <br />
                      <span className="text-muted-foreground">
                        {item.accountNameSnapshot}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.batchItems[0]?.batch.batchNumber || "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(item.requestedAt), "MM/dd HH:mm", {
                        locale: zhTW,
                      })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.completedAt
                        ? format(new Date(item.completedAt), "MM/dd HH:mm", {
                            locale: zhTW,
                          })
                        : item.failedAt
                          ? format(new Date(item.failedAt), "MM/dd HH:mm", {
                              locale: zhTW,
                            })
                          : "-"}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-xs text-red-600">
                      {lastFailure?.failureReason || ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          第 {page} / {totalPages || 1} 頁，共 {total} 筆
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

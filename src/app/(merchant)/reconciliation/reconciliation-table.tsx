"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AmountDisplay } from "@/components/amount-display";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import {
  SETTLEMENT_STATUS_LABELS,
  STATUS_COLORS,
  type SettlementStatus,
} from "@/lib/settlement-status";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "bg-gray-100 text-gray-800";
  const label = SETTLEMENT_STATUS_LABELS[status] || status;
  return (
    <Badge variant="outline" className={cn(color, "border-0")}>
      {label}
    </Badge>
  );
}

interface ReconciliationItem {
  id: string;
  status: string;
  itemAmountTaxIncl: { toString(): string };
  itemAmountTaxExcl: { toString(): string };
  commissionAmount: { toString(): string };
  netAmountTaxIncl: { toString(): string };
  netAmountTaxExcl: { toString(): string };
  reserveAmount: { toString(): string };
  paidAt: Date | string | null;
  deliveredAt: Date | string | null;
  appreciationEndsAt: Date | string | null;
  settledAt: Date | string | null;
  createdAt: Date | string;
  orderItem: {
    productName: string;
    sku: string | null;
    quantity: number;
    order: {
      orderNumber: string;
      shippingFeeTaxIncl: { toString(): string };
    };
    store: { name: string } | null;
    refundItems: Array<{
      refundAmountTaxIncl: { toString(): string };
      refund: { refundNumber: string };
    }>;
  };
  batch: { batchNumber: string } | null;
}

interface Props {
  items: ReconciliationItem[];
  total: number;
  page: number;
  totalPages: number;
}

export function ReconciliationTable({ items, total, page, totalPages }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(
    searchParams.get("orderNumber") || ""
  );
  const [sku, setSku] = useState(searchParams.get("sku") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");

  function applyFilters() {
    const params = new URLSearchParams();
    if (orderNumber) params.set("orderNumber", orderNumber);
    if (sku) params.set("sku", sku);
    if (status) params.set("status", status);
    params.set("page", "1");
    router.push(`/reconciliation?${params.toString()}`);
  }

  function clearFilters() {
    setOrderNumber("");
    setSku("");
    setStatus("");
    router.push("/reconciliation");
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", p.toString());
    router.push(`/reconciliation?${params.toString()}`);
  }

  const hasFilters = orderNumber || sku || status;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            訂單編號
          </label>
          <Input
            placeholder="搜尋訂單..."
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            SKU
          </label>
          <Input
            placeholder="搜尋 SKU..."
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            狀態
          </label>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="全部狀態" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SETTLEMENT_STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={applyFilters} size="sm">
          <Search className="mr-1 h-4 w-4" />
          篩選
        </Button>
        {hasFilters && (
          <Button onClick={clearFilters} variant="ghost" size="sm">
            <X className="mr-1 h-4 w-4" />
            清除
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訂單編號</TableHead>
              <TableHead>商品名稱</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>店鋪</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">商品金額</TableHead>
              <TableHead className="text-right">抽成</TableHead>
              <TableHead className="text-right">商家淨額</TableHead>
              <TableHead>付款時間</TableHead>
              <TableHead>結算日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center">
                  無資料
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      href={`/reconciliation/${item.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {item.orderItem.order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {item.orderItem.productName}
                    {item.orderItem.quantity > 1 &&
                      ` x${item.orderItem.quantity}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.orderItem.sku || "-"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {item.orderItem.store?.name || "-"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay
                      taxIncl={item.itemAmountTaxIncl.toString()}
                      taxExcl={item.itemAmountTaxExcl.toString()}
                      compact
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm text-red-600">
                    -{item.commissionAmount.toString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay
                      taxIncl={item.netAmountTaxIncl.toString()}
                      taxExcl={item.netAmountTaxExcl.toString()}
                      compact
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.paidAt
                      ? format(new Date(item.paidAt), "MM/dd HH:mm", {
                          locale: zhTW,
                        })
                      : "-"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.settledAt
                      ? format(new Date(item.settledAt), "MM/dd HH:mm", {
                          locale: zhTW,
                        })
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
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
            上一頁
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
          >
            下一頁
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

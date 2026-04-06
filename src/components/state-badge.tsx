import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SubOrderStatus,
  PayoutRequestStatus,
  DisputeStatus,
  BankAccountChangeStatus,
} from "@/generated/prisma";
import { PAYOUT_STATUS_LABELS } from "@/lib/state-machines/payout.machine";
import { DISPUTE_STATUS_LABELS } from "@/lib/state-machines/dispute.machine";
import { BANK_ACCOUNT_CHANGE_STATUS_LABELS } from "@/lib/state-machines/bank-account-change.machine";

const SUB_ORDER_STATUS_LABELS: Record<string, string> = {
  EXPECTED_PROFIT: "可預期獲利",
  PENDING_SHIPMENT: "待出貨",
  SHIPPED: "已出貨",
  IN_TRANSIT: "運送中",
  DELIVERED: "已送達",
  APPRECIATION_PERIOD: "鑑賞期中",
  SETTLEABLE: "可結算",
  SETTLED: "已結算",
  CANCELLED: "已取消",
};

type StatusType =
  | SubOrderStatus
  | PayoutRequestStatus
  | DisputeStatus
  | BankAccountChangeStatus;

const colorMap: Record<string, string> = {
  // Green - success/completed
  SUCCESS: "bg-green-100 text-green-800",
  AVAILABLE_FOR_PAYOUT: "bg-green-100 text-green-800",
  SETTLED_TO_WALLET: "bg-green-100 text-green-800",
  EFFECTIVE: "bg-green-100 text-green-800",
  APPROVED: "bg-green-100 text-green-800",
  RESOLVED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-800",

  // Yellow - pending/processing
  PENDING_PAYMENT: "bg-yellow-100 text-yellow-800",
  IN_APPRECIATION_PERIOD: "bg-yellow-100 text-yellow-800",
  SETTLEMENT_READY: "bg-yellow-100 text-yellow-800",
  REQUESTED: "bg-yellow-100 text-yellow-800",
  QUEUED: "bg-yellow-100 text-yellow-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  PENDING_REVIEW: "bg-yellow-100 text-yellow-800",
  WAITING_MERCHANT_RESPONSE: "bg-yellow-100 text-yellow-800",
  WAITING_PLATFORM_REVIEW: "bg-blue-100 text-blue-800",
  EVIDENCE_PENDING: "bg-yellow-100 text-yellow-800",

  // Red - failed/negative
  FAILED: "bg-red-100 text-red-800",
  RETURNED: "bg-red-100 text-red-800",
  REJECTED: "bg-red-100 text-red-800",
  REFUNDED: "bg-red-100 text-red-800",
  PARTIALLY_REFUNDED: "bg-orange-100 text-orange-800",

  // Blue - in progress
  PAID: "bg-blue-100 text-blue-800",
  SHIPPED: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-blue-100 text-blue-800",

  // Purple - frozen/reserved
  DISPUTE_FROZEN: "bg-purple-100 text-purple-800",
  PARTIALLY_FROZEN: "bg-purple-100 text-purple-800",
  ADJUSTED: "bg-indigo-100 text-indigo-800",

  // Default
  OPENED: "bg-orange-100 text-orange-800",
};

const allLabels: Record<string, string> = {
  ...SUB_ORDER_STATUS_LABELS,
  ...PAYOUT_STATUS_LABELS,
  ...DISPUTE_STATUS_LABELS,
  ...BANK_ACCOUNT_CHANGE_STATUS_LABELS,
};

interface StateBadgeProps {
  status: StatusType;
  className?: string;
}

export function StateBadge({ status, className }: StateBadgeProps) {
  const color = colorMap[status] || "bg-gray-100 text-gray-800";
  const label = allLabels[status] || status;

  return (
    <Badge variant="outline" className={cn(color, "border-0", className)}>
      {label}
    </Badge>
  );
}

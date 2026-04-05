/**
 * Settlement status constants for client-side use.
 * Mirrors the Prisma enum but can be imported in client components.
 */
export const SETTLEMENT_STATUSES = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  IN_APPRECIATION_PERIOD: "IN_APPRECIATION_PERIOD",
  SETTLEMENT_READY: "SETTLEMENT_READY",
  SETTLED_TO_WALLET: "SETTLED_TO_WALLET",
  AVAILABLE_FOR_PAYOUT: "AVAILABLE_FOR_PAYOUT",
  DISPUTE_FROZEN: "DISPUTE_FROZEN",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  ADJUSTED: "ADJUSTED",
  CLOSED: "CLOSED",
} as const;

export type SettlementStatus =
  (typeof SETTLEMENT_STATUSES)[keyof typeof SETTLEMENT_STATUSES];

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "待付款",
  PAID: "已付款",
  SHIPPED: "已出貨",
  DELIVERED: "已到貨",
  IN_APPRECIATION_PERIOD: "鑑賞期中",
  SETTLEMENT_READY: "可結算",
  SETTLED_TO_WALLET: "已入帳",
  AVAILABLE_FOR_PAYOUT: "可提領",
  DISPUTE_FROZEN: "爭議凍結",
  REFUNDED: "已退款",
  PARTIALLY_REFUNDED: "部分退款",
  ADJUSTED: "已調整",
  CLOSED: "已結案",
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "bg-yellow-100 text-yellow-800",
  PAID: "bg-blue-100 text-blue-800",
  SHIPPED: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-blue-100 text-blue-800",
  IN_APPRECIATION_PERIOD: "bg-yellow-100 text-yellow-800",
  SETTLEMENT_READY: "bg-yellow-100 text-yellow-800",
  SETTLED_TO_WALLET: "bg-green-100 text-green-800",
  AVAILABLE_FOR_PAYOUT: "bg-green-100 text-green-800",
  DISPUTE_FROZEN: "bg-purple-100 text-purple-800",
  REFUNDED: "bg-red-100 text-red-800",
  PARTIALLY_REFUNDED: "bg-orange-100 text-orange-800",
  ADJUSTED: "bg-indigo-100 text-indigo-800",
  CLOSED: "bg-gray-100 text-gray-800",
};

import { SettlementItemStatus } from "@/generated/prisma";

/**
 * Settlement Item State Machine
 *
 * PENDING_PAYMENT → PAID → SHIPPED → DELIVERED → IN_APPRECIATION_PERIOD
 * → SETTLEMENT_READY → SETTLED_TO_WALLET → AVAILABLE_FOR_PAYOUT
 * → DISPUTE_FROZEN | REFUNDED | PARTIALLY_REFUNDED | ADJUSTED | CLOSED
 */

const TRANSITIONS: Record<SettlementItemStatus, SettlementItemStatus[]> = {
  PENDING_PAYMENT: [SettlementItemStatus.PAID],
  PAID: [SettlementItemStatus.SHIPPED],
  SHIPPED: [SettlementItemStatus.DELIVERED],
  DELIVERED: [SettlementItemStatus.IN_APPRECIATION_PERIOD],
  IN_APPRECIATION_PERIOD: [SettlementItemStatus.SETTLEMENT_READY],
  SETTLEMENT_READY: [SettlementItemStatus.SETTLED_TO_WALLET],
  SETTLED_TO_WALLET: [SettlementItemStatus.AVAILABLE_FOR_PAYOUT],
  AVAILABLE_FOR_PAYOUT: [
    SettlementItemStatus.DISPUTE_FROZEN,
    SettlementItemStatus.REFUNDED,
    SettlementItemStatus.PARTIALLY_REFUNDED,
    SettlementItemStatus.ADJUSTED,
    SettlementItemStatus.CLOSED,
  ],
  DISPUTE_FROZEN: [
    SettlementItemStatus.AVAILABLE_FOR_PAYOUT,
    SettlementItemStatus.REFUNDED,
    SettlementItemStatus.ADJUSTED,
    SettlementItemStatus.CLOSED,
  ],
  REFUNDED: [SettlementItemStatus.CLOSED],
  PARTIALLY_REFUNDED: [
    SettlementItemStatus.REFUNDED,
    SettlementItemStatus.DISPUTE_FROZEN,
    SettlementItemStatus.ADJUSTED,
    SettlementItemStatus.CLOSED,
  ],
  ADJUSTED: [SettlementItemStatus.CLOSED],
  CLOSED: [],
};

export function canTransitionSettlement(
  from: SettlementItemStatus,
  to: SettlementItemStatus
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionSettlement(
  from: SettlementItemStatus,
  to: SettlementItemStatus
): void {
  if (!canTransitionSettlement(from, to)) {
    throw new Error(
      `Invalid settlement status transition: ${from} → ${to}`
    );
  }
}

/** Human-readable labels for UI */
export const SETTLEMENT_STATUS_LABELS: Record<SettlementItemStatus, string> = {
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

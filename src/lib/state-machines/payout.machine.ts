import { PayoutRequestStatus } from "@/generated/prisma";

/**
 * Payout Request State Machine
 *
 * REQUESTED → QUEUED → PROCESSING → SUCCESS | FAILED → RETURNED
 */

const TRANSITIONS: Record<PayoutRequestStatus, PayoutRequestStatus[]> = {
  REQUESTED: [PayoutRequestStatus.QUEUED],
  QUEUED: [PayoutRequestStatus.PROCESSING],
  PROCESSING: [PayoutRequestStatus.SUCCESS, PayoutRequestStatus.FAILED],
  SUCCESS: [],
  FAILED: [PayoutRequestStatus.RETURNED, PayoutRequestStatus.QUEUED],
  RETURNED: [],
};

export function canTransitionPayout(
  from: PayoutRequestStatus,
  to: PayoutRequestStatus
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionPayout(
  from: PayoutRequestStatus,
  to: PayoutRequestStatus
): void {
  if (!canTransitionPayout(from, to)) {
    throw new Error(`Invalid payout status transition: ${from} → ${to}`);
  }
}

export const PAYOUT_STATUS_LABELS: Record<PayoutRequestStatus, string> = {
  REQUESTED: "已申請",
  QUEUED: "排隊中",
  PROCESSING: "處理中",
  SUCCESS: "成功",
  FAILED: "失敗",
  RETURNED: "已退回",
};

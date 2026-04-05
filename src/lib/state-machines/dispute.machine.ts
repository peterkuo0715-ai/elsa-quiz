import { DisputeStatus } from "@/generated/prisma";

/**
 * Dispute Case State Machine
 *
 * OPENED → WAITING_MERCHANT_RESPONSE → WAITING_PLATFORM_REVIEW
 * → EVIDENCE_PENDING → PARTIALLY_FROZEN → RESOLVED | REJECTED → CLOSED
 */

const TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  OPENED: [
    DisputeStatus.WAITING_MERCHANT_RESPONSE,
    DisputeStatus.PARTIALLY_FROZEN,
  ],
  WAITING_MERCHANT_RESPONSE: [
    DisputeStatus.WAITING_PLATFORM_REVIEW,
    DisputeStatus.EVIDENCE_PENDING,
    DisputeStatus.PARTIALLY_FROZEN,
  ],
  WAITING_PLATFORM_REVIEW: [
    DisputeStatus.EVIDENCE_PENDING,
    DisputeStatus.RESOLVED,
    DisputeStatus.REJECTED,
  ],
  EVIDENCE_PENDING: [
    DisputeStatus.WAITING_MERCHANT_RESPONSE,
    DisputeStatus.WAITING_PLATFORM_REVIEW,
    DisputeStatus.PARTIALLY_FROZEN,
  ],
  PARTIALLY_FROZEN: [
    DisputeStatus.WAITING_PLATFORM_REVIEW,
    DisputeStatus.RESOLVED,
    DisputeStatus.REJECTED,
  ],
  RESOLVED: [DisputeStatus.CLOSED],
  REJECTED: [DisputeStatus.CLOSED],
  CLOSED: [],
};

export function canTransitionDispute(
  from: DisputeStatus,
  to: DisputeStatus
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionDispute(
  from: DisputeStatus,
  to: DisputeStatus
): void {
  if (!canTransitionDispute(from, to)) {
    throw new Error(`Invalid dispute status transition: ${from} → ${to}`);
  }
}

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPENED: "已開案",
  WAITING_MERCHANT_RESPONSE: "等待商家回覆",
  WAITING_PLATFORM_REVIEW: "平台審核中",
  EVIDENCE_PENDING: "待補件",
  PARTIALLY_FROZEN: "部分凍結",
  RESOLVED: "已解決",
  REJECTED: "已駁回",
  CLOSED: "已結案",
};

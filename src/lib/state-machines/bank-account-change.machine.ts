import { BankAccountChangeStatus } from "@/generated/prisma";

/**
 * Bank Account Change Request State Machine
 *
 * PENDING_REVIEW → APPROVED | REJECTED → EFFECTIVE
 */

const TRANSITIONS: Record<BankAccountChangeStatus, BankAccountChangeStatus[]> =
  {
    PENDING_REVIEW: [
      BankAccountChangeStatus.APPROVED,
      BankAccountChangeStatus.REJECTED,
    ],
    APPROVED: [BankAccountChangeStatus.EFFECTIVE],
    REJECTED: [],
    EFFECTIVE: [],
  };

export function canTransitionBankAccountChange(
  from: BankAccountChangeStatus,
  to: BankAccountChangeStatus
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionBankAccountChange(
  from: BankAccountChangeStatus,
  to: BankAccountChangeStatus
): void {
  if (!canTransitionBankAccountChange(from, to)) {
    throw new Error(
      `Invalid bank account change status transition: ${from} → ${to}`
    );
  }
}

export const BANK_ACCOUNT_CHANGE_STATUS_LABELS: Record<
  BankAccountChangeStatus,
  string
> = {
  PENDING_REVIEW: "審核中",
  APPROVED: "已核准",
  REJECTED: "已拒絕",
  EFFECTIVE: "已生效",
};

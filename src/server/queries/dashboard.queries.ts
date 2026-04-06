// Placeholder - pending v2 rewrite
import { ZERO } from "@/lib/money";
export async function getProjectedIncome(merchantId: string) { return { total: ZERO, appreciation: { count: 0, amount: ZERO, nearestEndDate: null }, shipped: { count: 0, amount: ZERO }, paid: { count: 0, amount: ZERO } }; }
export async function getDailyTrend(merchantId: string, days: number = 7) { return []; }
export async function getPendingActions(merchantId: string) { return { activeDisputes: 0, pendingBankChange: 0, isFrozen: false, payoutSuspended: false, frozenReason: null }; }

// Placeholder - pending v2 rewrite with RefundCalculationService
import { ZERO } from "@/lib/money";
export const RefundService = {
  calculateRefundBreakdown(params: any) { return { refundAmount: ZERO, commissionRefund: ZERO, paymentFeeRefund: ZERO, campaignCostRecovery: ZERO, netMerchantDebit: ZERO }; },
  async processRefundItem(prisma: any, params: any) {},
};

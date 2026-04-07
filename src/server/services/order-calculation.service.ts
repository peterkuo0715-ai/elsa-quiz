import Decimal from "decimal.js";
import { money, moneyMul, moneySub, moneyRound, moneyCeil, moneyAdd, ZERO } from "@/lib/money";

/**
 * OrderCalculationService
 *
 * Implements PRD Section 4 calculation sequence:
 * 1. Get original price
 * 2. Compare member/campaign price → final price before hi-coin
 * 3. Apply platform/merchant coupons
 * 4. Calculate hi-coin max usable (post-coupon × 50%)
 * 5. Apply hi-coin (order-level → proportional allocation to sub-orders)
 * 6. Add shipping
 * 7. Calculate payment fee (sub-order cash paid × rate)
 * 8. Calculate store commission + category commission (settlement base × rate)
 * 9. Deduct invoice fee (fixed 2/sub-order, non-refundable)
 * 10. Calculate merchant receivable (min 0 protection)
 */

// ================================================================
// Types
// ================================================================

export interface ProductInput {
  productName: string;
  merchantId: string;
  categoryId?: string;
  originalPrice: number;
  memberPrice?: number;
  campaignPrice?: number;
  referralPrice?: number;    // PRD v3: 推薦碼價（與 VIP 同層擇一）
  quantity: number;
}

export interface CouponInput {
  type: "PLATFORM" | "MERCHANT";
  amount: number;  // 折扣金額
}

export interface OrderCalculationInput {
  products: ProductInput[];
  coupons: CouponInput[];
  hiCoinUsed: number;          // 消費者希望使用的嗨幣
  shippingFees: Record<string, number>;  // merchantId → shipping fee
  paymentFeeRate: number;      // 金流費率
  merchantCommissions: Record<string, { storeRate: number; categoryRate: number }>;
  // PRD v3: 導購獎勵
  referralRewardPerItem?: number;    // 推薦碼：每件推薦人獎勵嗨幣
  listGuideRewardPerItem?: number;   // 清單導購：每件清單建立者獎勵嗨幣
}

export interface SubOrderResult {
  merchantId: string;
  items: SubOrderItemResult[];
  // 子單金額
  subOrderFinalItemAmount: Decimal;
  subOrderSettlementBaseAmount: Decimal;
  subOrderHiCoinAllocated: Decimal;
  subOrderShippingFee: Decimal;
  subOrderCashItemAmount: Decimal;       // = finalItemAmount - hiCoin
  subOrderCashPaidAmount: Decimal;       // = cashItemAmount + shipping
  // 費用
  storeCommissionRate: Decimal;
  storeCommissionAmount: Decimal;
  categoryCommissionRate: Decimal;
  categoryCommissionAmount: Decimal;
  paymentFeeBase: Decimal;               // 金流費基礎 = 商品全額 + 運費
  estimatedPaymentFeeAmount: Decimal;
  invoiceFeeAmount: Decimal;             // 固定2元
  // PRD v3: 導購獎勵成本（商家承擔）
  referralRewardCost: Decimal;           // 推薦碼獎勵嗨幣
  listGuideRewardCost: Decimal;          // 清單導購獎勵嗨幣
  totalRewardDeduction: Decimal;         // 導購總扣款
  // 結果
  merchantReceivableAmount: Decimal;     // 商家應得 (最低0，含導購扣款)
  platformAbsorbedAmount: Decimal;       // 平台吸收差額
}

export interface SubOrderItemResult {
  productName: string;
  merchantId: string;
  quantity: number;
  originalPrice: Decimal;
  finalPriceBeforeHiCoin: Decimal;
  platformCouponAmount: Decimal;
  merchantCouponAmount: Decimal;
  settlementBasePrice: Decimal;
  hiCoinAllocableAmount: Decimal;
  hiCoinAllocatedAmount: Decimal;
}

export interface OrderCalculationResult {
  // 訂單層
  originalItemAmount: Decimal;
  finalItemAmountBeforeCoupon: Decimal;
  totalPlatformCouponAmount: Decimal;
  totalMerchantCouponAmount: Decimal;
  hiCoinMaxUsableAmount: Decimal;
  hiCoinTotalUsed: Decimal;
  shippingTotalAmount: Decimal;
  cashTotalPaid: Decimal;
  // 子單
  subOrders: SubOrderResult[];
}

// ================================================================
// Calculation Engine
// ================================================================

export const OrderCalculationService = {
  calculate(input: OrderCalculationInput): OrderCalculationResult {
    // Step 1-2: Final price per item
    // PRD v3 3.3: VIP 與推薦碼屬同層，擇一取較低者。嗨幣屬支付工具層可並存。
    const items = input.products.map((p) => {
      const original = money(p.originalPrice);
      // 同層級價格規則：VIP(member) vs 推薦碼(referral)，擇一
      const candidates = [original];
      if (p.memberPrice != null) candidates.push(money(p.memberPrice));
      if (p.campaignPrice != null) candidates.push(money(p.campaignPrice));
      if (p.referralPrice != null) candidates.push(money(p.referralPrice));
      const finalPrice = Decimal.min(...candidates);

      return {
        ...p,
        originalPriceD: original,
        finalPriceBeforeHiCoin: moneyRound(finalPrice),
        platformCouponAmount: ZERO,
        merchantCouponAmount: ZERO,
        settlementBasePrice: ZERO,
        hiCoinAllocableAmount: ZERO,
        hiCoinAllocatedAmount: ZERO,
      };
    });

    // Step 3: Apply coupons (proportionally across items)
    const totalFinalBeforeCoupon = items.reduce((s, i) => s.plus(moneyMul(i.finalPriceBeforeHiCoin, i.quantity)), ZERO);
    let totalPlatformCoupon = ZERO;
    let totalMerchantCoupon = ZERO;

    for (const coupon of input.coupons) {
      const couponAmt = money(coupon.amount);
      // Distribute coupon proportionally, floor + tail diff to last item
      let remaining = couponAmt;
      for (let i = 0; i < items.length; i++) {
        const itemTotal = moneyMul(items[i].finalPriceBeforeHiCoin, items[i].quantity);
        const share = i === items.length - 1
          ? remaining  // last item gets remainder (尾差)
          : moneyMul(couponAmt, itemTotal.dividedBy(totalFinalBeforeCoupon)).floor();
        const actualShare = Decimal.min(share, remaining);

        if (coupon.type === "PLATFORM") {
          items[i].platformCouponAmount = items[i].platformCouponAmount.plus(actualShare);
          totalPlatformCoupon = totalPlatformCoupon.plus(actualShare);
        } else {
          items[i].merchantCouponAmount = items[i].merchantCouponAmount.plus(actualShare);
          totalMerchantCoupon = totalMerchantCoupon.plus(actualShare);
        }
        remaining = remaining.minus(actualShare);
      }
    }

    // Step 3b: Calculate settlement base per item
    // PRD: 平台券不下修結算基礎，商家券下修
    for (const item of items) {
      const itemTotal = moneyMul(item.finalPriceBeforeHiCoin, item.quantity);
      item.settlementBasePrice = moneyRound(moneySub(itemTotal, item.merchantCouponAmount));
    }

    // Step 4: Calculate hi-coin max usable
    // PRD 5.3: 嗨幣上限基礎 = 平台券+商家券折後金額
    const hiCoinLimitBase = items.reduce((s, i) => {
      const itemTotal = moneyMul(i.finalPriceBeforeHiCoin, i.quantity);
      return s.plus(moneySub(itemTotal, i.platformCouponAmount.plus(i.merchantCouponAmount)));
    }, ZERO);
    const hiCoinMaxUsable = moneyRound(moneyMul(hiCoinLimitBase, 0.5)); // 50% cap

    // Step 5: Apply hi-coin
    const hiCoinActual = Decimal.min(money(input.hiCoinUsed), hiCoinMaxUsable);

    // PRD 5.4: 分攤至各子單，依商品金額占比
    // First, calculate hi-coin allocable amount per item (post-coupon)
    for (const item of items) {
      const itemTotal = moneyMul(item.finalPriceBeforeHiCoin, item.quantity);
      item.hiCoinAllocableAmount = moneyRound(moneySub(itemTotal, item.platformCouponAmount.plus(item.merchantCouponAmount)));
    }

    const totalAllocable = items.reduce((s, i) => s.plus(i.hiCoinAllocableAmount), ZERO);
    let hiCoinRemaining = hiCoinActual;

    // Find item with highest amount for tail diff
    let maxAmtIdx = 0;
    let maxAmt = ZERO;
    items.forEach((item, idx) => {
      if (item.hiCoinAllocableAmount.greaterThan(maxAmt)) {
        maxAmt = item.hiCoinAllocableAmount;
        maxAmtIdx = idx;
      }
    });

    // Allocate proportionally with floor, tail diff to highest amount item (PRD 5.5)
    for (let i = 0; i < items.length; i++) {
      if (totalAllocable.isZero()) break;
      if (i === maxAmtIdx) continue; // skip max item, gets remainder
      // floor to integer — 尾差不要在這裡產生，全部留給最高金額商品
      const share = moneyMul(hiCoinActual, items[i].hiCoinAllocableAmount.dividedBy(totalAllocable)).floor();
      const actual = Decimal.min(share, hiCoinRemaining, items[i].hiCoinAllocableAmount);
      items[i].hiCoinAllocatedAmount = actual;
      hiCoinRemaining = hiCoinRemaining.minus(actual);
    }
    // Tail diff: highest amount item gets all remainder (PRD 5.5 尾差規則)
    items[maxAmtIdx].hiCoinAllocatedAmount = Decimal.min(hiCoinRemaining, items[maxAmtIdx].hiCoinAllocableAmount);

    const hiCoinTotalUsed = items.reduce((s, i) => s.plus(i.hiCoinAllocatedAmount), ZERO);

    // Step 6-10: Group by merchant → sub-orders
    const merchantGroups = new Map<string, typeof items>();
    for (const item of items) {
      const list = merchantGroups.get(item.merchantId) || [];
      list.push(item);
      merchantGroups.set(item.merchantId, list);
    }

    const subOrders: SubOrderResult[] = [];
    let shippingTotal = ZERO;
    let cashTotalPaid = ZERO;

    for (const [merchantId, merchantItems] of merchantGroups) {
      const shipping = money(input.shippingFees[merchantId] || 0);
      shippingTotal = shippingTotal.plus(shipping);

      const subFinalItemAmount = merchantItems.reduce((s, i) => s.plus(moneyMul(i.finalPriceBeforeHiCoin, i.quantity)), ZERO);
      const subSettlementBase = merchantItems.reduce((s, i) => s.plus(i.settlementBasePrice), ZERO);
      const subHiCoin = merchantItems.reduce((s, i) => s.plus(i.hiCoinAllocatedAmount), ZERO);
      const subCashItem = moneyRound(moneySub(subFinalItemAmount, subHiCoin));
      const subCashPaid = moneyRound(moneyAdd(subCashItem, shipping));

      // Commission (PRD 6.1, 6.2) — 基礎 = 結算基礎（運費不參與抽成）
      const commConfig = input.merchantCommissions[merchantId] || { storeRate: 0, categoryRate: 0 };
      const storeRate = money(commConfig.storeRate);
      const categoryRate = money(commConfig.categoryRate);
      const storeCommission = moneyCeil(moneyMul(subSettlementBase, storeRate));
      const categoryCommission = moneyCeil(moneyMul(subSettlementBase, categoryRate));

      // Payment fee — 基礎 = 商品全額 + 運費（不扣嗨幣，嗨幣是平台內部折抵，實際金流走全額）
      const paymentFeeBase = moneyRound(moneyAdd(subFinalItemAmount, shipping));
      const paymentFee = moneyCeil(moneyMul(paymentFeeBase, input.paymentFeeRate));

      // Invoice fee (PRD 6.4) - fixed 2/sub-order
      const invoiceFee = money(2);

      // PRD v3: 導購獎勵成本（商家承擔）
      const itemCount = merchantItems.reduce((s, i) => s + i.quantity, 0);
      const referralRewardCost = input.referralRewardPerItem ? moneyRound(moneyMul(money(input.referralRewardPerItem), itemCount)) : ZERO;
      const listGuideRewardCost = input.listGuideRewardPerItem ? moneyRound(moneyMul(money(input.listGuideRewardPerItem), itemCount)) : ZERO;
      const totalRewardDeduction = moneyRound(referralRewardCost.plus(listGuideRewardCost));

      // Merchant receivable (PRD v3 7.1)
      // = settlementBase - storeComm - categoryComm - paymentFee - invoiceFee - rewardDeduction + shipping
      let merchantReceivable = subSettlementBase
        .minus(storeCommission)
        .minus(categoryCommission)
        .minus(paymentFee)
        .minus(invoiceFee)
        .minus(totalRewardDeduction)
        .plus(shipping);
      merchantReceivable = moneyRound(merchantReceivable);

      // Min protection (PRD 7.2)
      let platformAbsorbed = ZERO;
      if (merchantReceivable.isNegative()) {
        platformAbsorbed = merchantReceivable.abs();
        merchantReceivable = ZERO;
      }

      cashTotalPaid = cashTotalPaid.plus(subCashPaid);

      subOrders.push({
        merchantId,
        items: merchantItems.map((i) => ({
          productName: i.productName,
          merchantId: i.merchantId,
          quantity: i.quantity,
          originalPrice: i.originalPriceD,
          finalPriceBeforeHiCoin: i.finalPriceBeforeHiCoin,
          platformCouponAmount: i.platformCouponAmount,
          merchantCouponAmount: i.merchantCouponAmount,
          settlementBasePrice: i.settlementBasePrice,
          hiCoinAllocableAmount: i.hiCoinAllocableAmount,
          hiCoinAllocatedAmount: i.hiCoinAllocatedAmount,
        })),
        subOrderFinalItemAmount: subFinalItemAmount,
        subOrderSettlementBaseAmount: subSettlementBase,
        subOrderHiCoinAllocated: subHiCoin,
        subOrderShippingFee: shipping,
        subOrderCashItemAmount: subCashItem,
        subOrderCashPaidAmount: subCashPaid,
        storeCommissionRate: storeRate,
        storeCommissionAmount: storeCommission,
        categoryCommissionRate: categoryRate,
        categoryCommissionAmount: categoryCommission,
        paymentFeeBase: paymentFeeBase,
        estimatedPaymentFeeAmount: paymentFee,
        invoiceFeeAmount: invoiceFee,
        referralRewardCost,
        listGuideRewardCost,
        totalRewardDeduction,
        merchantReceivableAmount: merchantReceivable,
        platformAbsorbedAmount: platformAbsorbed,
      });
    }

    return {
      originalItemAmount: items.reduce((s, i) => s.plus(moneyMul(i.originalPriceD, i.quantity)), ZERO),
      finalItemAmountBeforeCoupon: totalFinalBeforeCoupon,
      totalPlatformCouponAmount: totalPlatformCoupon,
      totalMerchantCouponAmount: totalMerchantCoupon,
      hiCoinMaxUsableAmount: hiCoinMaxUsable,
      hiCoinTotalUsed: hiCoinTotalUsed,
      shippingTotalAmount: shippingTotal,
      cashTotalPaid: cashTotalPaid,
      subOrders,
    };
  },

  /**
   * Verify PRD example 14.1:
   * product=1000, hiCoin=200, shipping=100, storeRate=3%, categoryRate=0%, paymentFeeRate=2%, invoiceFee=2
   * Expected: merchantReceivable = 1050
   */
  verifyExample(): string {
    const result = this.calculate({
      products: [{ productName: "測試商品", merchantId: "m1", originalPrice: 1000, quantity: 1 }],
      coupons: [],
      hiCoinUsed: 200,
      shippingFees: { m1: 100 },
      paymentFeeRate: 0.02,
      merchantCommissions: { m1: { storeRate: 0.03, categoryRate: 0 } },
    });

    const so = result.subOrders[0];
    const lines = [
      `子單商品現金支付額 = ${so.subOrderFinalItemAmount} - ${so.subOrderHiCoinAllocated} = ${so.subOrderCashItemAmount}`,
      `子單現金實付總額 = ${so.subOrderCashItemAmount} + ${so.subOrderShippingFee} = ${so.subOrderCashPaidAmount}`,
      `商店抽成 = ${so.subOrderSettlementBaseAmount} × ${so.storeCommissionRate} = ${so.storeCommissionAmount}`,
      `金流費 = ${so.subOrderCashPaidAmount} × ${result.cashTotalPaid.dividedBy(so.subOrderCashPaidAmount).times(0.02)} = ${so.estimatedPaymentFeeAmount}`,
      `商家應得 = ${so.subOrderSettlementBaseAmount} - ${so.storeCommissionAmount} - ${so.categoryCommissionAmount} - ${so.estimatedPaymentFeeAmount} - ${so.invoiceFeeAmount} + ${so.subOrderShippingFee} = ${so.merchantReceivableAmount}`,
      `驗證: 商家應得 ${so.merchantReceivableAmount} (期望: 1050)`,
    ];
    return lines.join("\n");
  },
};

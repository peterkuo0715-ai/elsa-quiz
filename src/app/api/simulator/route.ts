import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { DisputeService } from "@/server/services/dispute.service";
import { OrderCalculationService } from "@/server/services/order-calculation.service";
import {
  SubOrderStatus, SettlementStatus, DisputeStatus,
  WalletBucket, LedgerEntryType, ReferenceType, RefundType, RefundStatus, SnapshotType,
} from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyToString, ZERO, moneyAdd } from "@/lib/money";
import { addDays, subDays } from "date-fns";
import type { PrismaClient } from "@/generated/prisma";

const TX = () => prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
const PC = () => prisma as unknown as PrismaClient;
const uid = () => `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function getMerchantA() {
  const m = await prisma.merchant.findFirst({
    where: { taxId: "12345678" },
    include: { wallet: true, stores: true, bankAccounts: { where: { isActive: true } } },
  });
  if (!m || !m.wallet) throw new Error("Merchant A not found");
  return m;
}

// ================================================================
// Execute: takes L1-L4, runs full order lifecycle via new calculation engine
// PRD v4: 4-layer time separation model
// ================================================================
interface ExecuteParams {
  l1: "single" | "multi";
  lShipping: "shipping_paid" | "free_shipping";
  l2: "cash" | "hicoin" | "hicoin_platform_coupon" | "hicoin_merchant_coupon";
  lGuide: "no_guide" | "referral" | "list_guide";
  l3: "full_pay" | "installment";
  l4: "paid" | "fulfilled" | "retention_period" | "settleable" | "settled"
    | "dispute" | "negotiated" | "full_refund" | "adjudicated" | "partial_return";
  refundAmount?: number;
}

async function execute(params: ExecuteParams) {
  const m = await getMerchantA();
  const id = uid();

  // === Build calculation input from L1-L4 ===
  const isSingle = params.l1 === "single";
  const hasHiCoin = params.l2 !== "cash";
  const hasPlatformCoupon = params.l2 === "hicoin_platform_coupon";
  const hasMerchantCoupon = params.l2 === "hicoin_merchant_coupon";
  const isReferral = params.lGuide === "referral";
  const isListGuide = params.lGuide === "list_guide";
  const isInstallment = params.l3 === "installment";
  const paymentFeeRate = isInstallment ? 0.035 : 0.02;

  const products = isSingle
    ? [{
        productName: "藍芽耳機", merchantId: m.id, originalPrice: 1500, memberPrice: 1400,
        ...(isReferral ? { referralPrice: 1350 } : {}),
        quantity: 1,
      }]
    : [
        {
          productName: "藍芽耳機", merchantId: m.id, originalPrice: 1500, memberPrice: 1400,
          ...(isReferral ? { referralPrice: 1350 } : {}),
          quantity: 1,
        },
        {
          productName: "耳機保護殼", merchantId: m.id, originalPrice: 500, campaignPrice: 450,
          ...(isReferral ? { referralPrice: 450 } : {}),
          quantity: 1,
        },
      ];

  const coupons: Array<{ type: "PLATFORM" | "MERCHANT"; amount: number }> = [];
  if (hasPlatformCoupon) coupons.push({ type: "PLATFORM", amount: 100 });
  if (hasMerchantCoupon) coupons.push({ type: "MERCHANT", amount: 100 });

  const hiCoinUsed = hasHiCoin ? 200 : 0;

  // === Run calculation engine (PRD v3) ===
  const calc = OrderCalculationService.calculate({
    products,
    coupons,
    hiCoinUsed,
    shippingFees: { [m.id]: params.lShipping === "free_shipping" ? 0 : 80 },
    paymentFeeRate,
    merchantCommissions: { [m.id]: { storeRate: 0.03, categoryRate: 0.02 } },
    referralRewardPerItem: isReferral ? 50 : undefined,
    listGuideRewardPerItem: isListGuide ? 80 : undefined,
  });

  const so = calc.subOrders[0];

  // === PRD v4: Determine time points based on L4 ===
  const now = new Date();
  let paidAt: Date | null = null;
  let fulfilledAt: Date | null = null;
  let retentionEndAt: Date | null = null;
  let settleableAt: Date | null = null;
  let paidOutAt: Date | null = null;
  let subOrderStatus: SubOrderStatus;
  let settlementStatus: SettlementStatus;
  let isAmountConfirmed = false;
  let walletBucket: WalletBucket;

  switch (params.l4) {
    case "paid":
      // L1: 剛付款，等待履約
      paidAt = now;
      subOrderStatus = SubOrderStatus.PAID;
      settlementStatus = SettlementStatus.ESTIMATED;
      walletBucket = WalletBucket.PENDING;
      break;
    case "fulfilled":
      // L2: 履約完成，保留期開始
      paidAt = subDays(now, 3);
      fulfilledAt = now;
      retentionEndAt = addDays(now, 7);
      subOrderStatus = SubOrderStatus.FULFILLMENT_COMPLETE;
      settlementStatus = SettlementStatus.ESTIMATED;
      walletBucket = WalletBucket.PENDING;
      break;
    case "retention_period":
      // 保留期中（履約完成3天，剩餘4天）
      paidAt = subDays(now, 6);
      fulfilledAt = subDays(now, 3);
      retentionEndAt = addDays(now, 4);
      subOrderStatus = SubOrderStatus.RETENTION_PERIOD;
      settlementStatus = SettlementStatus.ESTIMATED;
      walletBucket = WalletBucket.PENDING;
      break;
    case "settleable":
      // L3: 保留期結束，可結算
      paidAt = subDays(now, 12);
      fulfilledAt = subDays(now, 9);
      retentionEndAt = subDays(now, 2);
      settleableAt = subDays(now, 2);
      isAmountConfirmed = true;
      subOrderStatus = SubOrderStatus.SETTLEABLE;
      settlementStatus = SettlementStatus.SETTLEABLE;
      walletBucket = WalletBucket.AVAILABLE;
      break;
    case "settled":
      // L4: 撥款完成
      paidAt = subDays(now, 15);
      fulfilledAt = subDays(now, 12);
      retentionEndAt = subDays(now, 5);
      settleableAt = subDays(now, 5);
      paidOutAt = now;
      isAmountConfirmed = true;
      subOrderStatus = SubOrderStatus.SETTLED;
      settlementStatus = SettlementStatus.SETTLED;
      walletBucket = WalletBucket.AVAILABLE;
      break;
    // 爭議/退款 case 都基於「已可結算」狀態
    default:
      paidAt = subDays(now, 12);
      fulfilledAt = subDays(now, 9);
      retentionEndAt = subDays(now, 2);
      settleableAt = subDays(now, 2);
      isAmountConfirmed = true;
      subOrderStatus = SubOrderStatus.SETTLEABLE;
      settlementStatus = SettlementStatus.SETTLEABLE;
      walletBucket = WalletBucket.AVAILABLE;
      break;
  }

  // === Write to DB ===
  const order = await prisma.order.create({
    data: {
      id: `${id}-ord`, orderNumber: `ORD-${id}`, memberId: "consumer-1",
      originalItemAmount: moneyToString(calc.originalItemAmount),
      finalItemAmountBeforeCoupon: moneyToString(calc.finalItemAmountBeforeCoupon),
      totalPlatformCouponAmount: moneyToString(calc.totalPlatformCouponAmount),
      totalMerchantCouponAmount: moneyToString(calc.totalMerchantCouponAmount),
      hiCoinMaxUsableAmount: moneyToString(calc.hiCoinMaxUsableAmount),
      hiCoinTotalUsed: moneyToString(calc.hiCoinTotalUsed),
      shippingTotalAmount: moneyToString(calc.shippingTotalAmount),
      cashTotalPaid: moneyToString(calc.cashTotalPaid),
      expectedProfitStatus: true,
      paidAt: paidAt,
      items: {
        create: so.items.map((item) => ({
          merchantId: m.id,
          productName: item.productName,
          quantity: item.quantity,
          originalPrice: moneyToString(item.originalPrice),
          finalPriceBeforeHiCoin: moneyToString(item.finalPriceBeforeHiCoin),
          platformCouponAmount: moneyToString(item.platformCouponAmount),
          merchantCouponAmount: moneyToString(item.merchantCouponAmount),
          settlementBasePrice: moneyToString(item.settlementBasePrice),
          hiCoinAllocableAmount: moneyToString(item.hiCoinAllocableAmount),
          hiCoinAllocatedAmount: moneyToString(item.hiCoinAllocatedAmount),
        })),
      },
    },
    include: { items: true },
  });

  await prisma.paymentTransaction.create({
    data: {
      orderId: order.id,
      paymentMethod: isInstallment ? "CREDIT_CARD_INSTALLMENT" : "CREDIT_CARD",
      paymentStatus: "SUCCESS",
      paymentFeeRateSnapshot: moneyToString(money(paymentFeeRate)),
      paymentAmount: moneyToString(calc.cashTotalPaid),
      estimatedPaymentFeeAmount: moneyToString(so.estimatedPaymentFeeAmount),
      paidAt: paidAt || now,
    },
  });

  const subOrder = await prisma.subOrder.create({
    data: {
      orderId: order.id, merchantId: m.id,
      subOrderStatus,
      settlementStatus,
      // 舊欄位（相容）
      appreciationPeriodStartAt: fulfilledAt,
      appreciationPeriodEndAt: retentionEndAt,
      // 新 PRD v4 時間點
      paidAt,
      fulfilledAt,
      retentionEndAt,
      settleableAt,
      paidOutAt,
      isAmountConfirmed,
      // 金額
      expectedSettlementAmount: moneyToString(so.merchantReceivableAmount),
      availableSettlementAmount: isAmountConfirmed ? moneyToString(so.merchantReceivableAmount) : "0",
      subOrderFinalItemAmount: moneyToString(so.subOrderFinalItemAmount),
      subOrderSettlementBaseAmount: moneyToString(so.subOrderSettlementBaseAmount),
      subOrderHiCoinAllocated: moneyToString(so.subOrderHiCoinAllocated),
      subOrderShippingFee: moneyToString(so.subOrderShippingFee),
      subOrderCashItemAmount: moneyToString(so.subOrderCashItemAmount),
      subOrderCashPaidAmount: moneyToString(so.subOrderCashPaidAmount),
      storeCommissionRate: moneyToString(so.storeCommissionRate),
      storeCommissionAmount: moneyToString(so.storeCommissionAmount),
      categoryCommissionRate: moneyToString(so.categoryCommissionRate),
      categoryCommissionAmount: moneyToString(so.categoryCommissionAmount),
      estimatedPaymentFeeAmount: moneyToString(so.estimatedPaymentFeeAmount),
      invoiceFeeAmount: moneyToString(so.invoiceFeeAmount),
      referralRewardCost: moneyToString(so.referralRewardCost),
      listGuideRewardCost: moneyToString(so.listGuideRewardCost),
      totalRewardDeduction: moneyToString(so.totalRewardDeduction),
      merchantReceivableAmount: moneyToString(so.merchantReceivableAmount),
      platformAbsorbedAmount: moneyToString(so.platformAbsorbedAmount),
      items: {
        create: so.items.map((item, idx) => ({
          orderItemId: order.items[idx].id,
          productName: item.productName,
          quantity: item.quantity,
          finalPriceBeforeHiCoin: moneyToString(item.finalPriceBeforeHiCoin),
          settlementBasePrice: moneyToString(item.settlementBasePrice),
          hiCoinAllocatedAmount: moneyToString(item.hiCoinAllocatedAmount),
        })),
      },
    },
    include: { items: true },
  });

  // Snapshot
  await prisma.settlementSnapshot.create({
    data: {
      subOrderId: subOrder.id,
      snapshotType: SnapshotType.EXPECTED_PROFIT,
      amountBefore: "0",
      amountAfter: moneyToString(so.merchantReceivableAmount),
      reasonCode: "PAYMENT_SUCCESS",
      reasonDetail: "付款成功，建立預計值",
    },
  });

  // Ledger entries
  const receivable = so.merchantReceivableAmount;
  const isPendingBucket = (
    subOrderStatus === SubOrderStatus.PAID ||
    subOrderStatus === SubOrderStatus.FULFILLMENT_COMPLETE ||
    subOrderStatus === SubOrderStatus.RETENTION_PERIOD
  );

  if (isPendingBucket) {
    const bd = { taxIncl: receivable, taxExcl: receivable, taxAmount: ZERO };
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.PENDING,
      entryType: LedgerEntryType.ORDER_PENDING_SETTLEMENT,
      amount: bd.taxIncl, amountTaxIncl: bd.taxIncl, amountTaxExcl: bd.taxExcl, taxAmount: bd.taxAmount,
      referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
      idempotencyKey: `sim-pend-${subOrder.id}`, description: `待結算(預計值): ${order.orderNumber}`,
    });
  } else {
    const bd = { taxIncl: receivable, taxExcl: receivable, taxAmount: ZERO };
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.SETTLEMENT_RELEASED,
      amount: bd.taxIncl, amountTaxIncl: bd.taxIncl, amountTaxExcl: bd.taxExcl, taxAmount: bd.taxAmount,
      referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
      idempotencyKey: `sim-settle-${subOrder.id}`, description: `結算入帳(確認值): ${order.orderNumber}`,
    });
    // 如果是 settled，再加一筆撥款 snapshot
    if (params.l4 === "settled") {
      await prisma.settlementSnapshot.create({
        data: {
          subOrderId: subOrder.id,
          snapshotType: SnapshotType.PAYOUT_COMPLETED,
          amountBefore: moneyToString(receivable),
          amountAfter: moneyToString(receivable),
          reasonCode: "WEEKLY_PAYOUT",
          reasonDetail: "週批次撥款完成",
        },
      });
    }
  }

  // === L4 specific actions ===
  const details: string[] = [];
  let consumerRefund = { cash: ZERO, hiCoin: ZERO };
  const amountLabel = isAmountConfirmed ? "" : "(預估) ";

  // Order summary
  details.push(`📋 ${order.orderNumber}`);
  for (const item of so.items) {
    const hiLabel = item.hiCoinAllocatedAmount.isZero() ? "" : ` (嗨幣${item.hiCoinAllocatedAmount})`;
    details.push(`   ${item.productName}: 原價${item.originalPrice} → 成交${item.finalPriceBeforeHiCoin}${hiLabel}`);
  }
  if (!calc.totalPlatformCouponAmount.isZero()) details.push(`   平台券: -${calc.totalPlatformCouponAmount}（不影響抽成基礎）`);
  if (!calc.totalMerchantCouponAmount.isZero()) details.push(`   商家券: -${calc.totalMerchantCouponAmount}（影響抽成基礎）`);
  details.push(`   付款: 台幣${calc.cashTotalPaid}${!calc.hiCoinTotalUsed.isZero() ? ` + 嗨幣${calc.hiCoinTotalUsed}` : ""} | ${isInstallment ? "分期" : "一次付清"} | 嗨幣上限${calc.hiCoinMaxUsableAmount}`);
  details.push(`   結算基礎: ${so.subOrderSettlementBaseAmount} | 商店抽成${so.storeCommissionAmount}(${so.storeCommissionRate.times(100)}%) + 分類抽成${so.categoryCommissionAmount}(${so.categoryCommissionRate.times(100)}%)`);
  details.push(`   金流費: ${so.estimatedPaymentFeeAmount} (基礎: ${so.paymentFeeBase}) | 發票費: ${so.invoiceFeeAmount}(不可退) | 運費: ${so.subOrderShippingFee}`);
  if (!so.totalRewardDeduction.isZero()) {
    details.push(`   🎁 導購獎勵扣款: ${so.totalRewardDeduction}${!so.referralRewardCost.isZero() ? ` (推薦碼${so.referralRewardCost})` : ""}${!so.listGuideRewardCost.isZero() ? ` (清單導購${so.listGuideRewardCost})` : ""} — 商家承擔`);
  }
  details.push(`   ${amountLabel}商家應得: ${so.merchantReceivableAmount}${!so.platformAbsorbedAmount.isZero() ? ` (平台吸收${so.platformAbsorbedAmount})` : ""}`);

  // Time points
  details.push(`\n⏱️ 時間軸:`);
  if (paidAt) details.push(`   收單時間: ${paidAt.toLocaleDateString("zh-TW")}`);
  if (fulfilledAt) details.push(`   履約完成: ${fulfilledAt.toLocaleDateString("zh-TW")}`);
  if (retentionEndAt) details.push(`   保留期截止: ${retentionEndAt.toLocaleDateString("zh-TW")}`);
  if (settleableAt) details.push(`   可結算時間: ${settleableAt.toLocaleDateString("zh-TW")}`);
  if (paidOutAt) details.push(`   撥款時間: ${paidOutAt.toLocaleDateString("zh-TW")}`);

  switch (params.l4) {
    case "paid":
      details.push(`\n📦 收單完成，等待商家出貨/履約`);
      details.push(`   金額狀態: 預計值（保留期結束前皆為預計）`);
      details.push(`   ${amountLabel}商家預計應得 ${so.merchantReceivableAmount} 在 Pending`);
      break;

    case "fulfilled":
      details.push(`\n🚚 履約完成，7天保留期開始`);
      details.push(`   金額狀態: 預計值`);
      details.push(`   保留期截止: ${retentionEndAt!.toLocaleDateString("zh-TW")}`);
      details.push(`   ${amountLabel}商家預計應得 ${so.merchantReceivableAmount} 在 Pending`);
      break;

    case "retention_period":
      details.push(`\n⏳ 保留期進行中（D+3/7天）`);
      details.push(`   金額狀態: 預計值（退款/爭議可能改變金額）`);
      details.push(`   剩餘: 4天後可結算`);
      details.push(`   ${amountLabel}商家預計應得 ${so.merchantReceivableAmount} 在 Pending`);
      break;

    case "settleable":
      details.push(`\n✅ 保留期結束，金額已確認，等待週批次撥款`);
      details.push(`   金額狀態: 確認值`);
      details.push(`   導購獎勵: ${isAmountConfirmed ? "已確認" : "預計值"}`);
      details.push(`   商家應得 ${so.merchantReceivableAmount} 已入帳至 Available`);
      break;

    case "settled":
      details.push(`\n💰 週批次撥款完成`);
      details.push(`   金額狀態: 已結算`);
      details.push(`   商家應得 ${so.merchantReceivableAmount} 已撥款`);
      break;

    case "dispute": {
      const freezeAmt = receivable;
      const d = await prisma.disputeCase.create({
        data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, subOrderId: subOrder.id,
          disputeReason: "消費者發起售後爭議", disputeAmount: moneyToString(freezeAmt),
          status: DisputeStatus.PARTIALLY_FROZEN },
      });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: freezeAmt.toString() });
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: { subOrderStatus: SubOrderStatus.DISPUTED } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(receivable),
        reasonCode: "DISPUTE_OPENED", reasonDetail: `售後爭議 ${d.caseNumber}，凍結商家應得 ${freezeAmt}`,
      } });
      details.push(`\n⚠️ 爭議處理中: ${d.caseNumber}`);
      details.push(`   狀態: 消費者發起售後 → 爭議處理中`);
      details.push(`   凍結: 商家應得 NT$${freezeAmt} 全額凍結至 Reserved`);
      details.push(`   後續: 可由平台進行「協商退款」或「仲裁退款」`);
      break;
    }

    case "full_refund": {
      consumerRefund = { cash: so.subOrderCashItemAmount, hiCoin: so.subOrderHiCoinAllocated };
      const shippingAmount = params.lShipping === "free_shipping" ? 0 : 80;
      let newReceivableAfterRefund = ZERO;
      if (shippingAmount > 0) {
        const shippingCalc = OrderCalculationService.calculate({
          products: [{ productName: "運費保留", merchantId: m.id, originalPrice: 0, quantity: 1 }],
          coupons: [],
          hiCoinUsed: 0,
          shippingFees: { [m.id]: shippingAmount },
          paymentFeeRate: isInstallment ? 0.035 : 0.02,
          merchantCommissions: { [m.id]: { storeRate: 0.03, categoryRate: 0.02 } },
        });
        newReceivableAfterRefund = shippingCalc.subOrders[0].merchantReceivableAmount;
      }
      const merchantDebit = moneyRound(moneySub(receivable, newReceivableAfterRefund));
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.REFUND_DEBIT, amount: merchantDebit.negated(),
        amountTaxIncl: merchantDebit.negated(), amountTaxExcl: merchantDebit.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
        idempotencyKey: `sim-refund-${subOrder.id}`, description: `全額退貨（運費保留）: ${order.orderNumber}`,
      });
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        subOrderStatus: SubOrderStatus.CANCELLED,
        merchantReceivableAmount: moneyToString(newReceivableAfterRefund),
        availableSettlementAmount: moneyToString(newReceivableAfterRefund),
        subOrderFinalItemAmount: "0",
        subOrderSettlementBaseAmount: "0",
        subOrderHiCoinAllocated: "0",
        subOrderCashItemAmount: "0",
        storeCommissionAmount: "0",
        categoryCommissionAmount: "0",
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(newReceivableAfterRefund),
        reasonCode: "FULL_REFUND", reasonDetail: `全額退貨，運費 ${shippingAmount} 保留給商家`,
      } });
      details.push(`\n🔄 全額退貨: 退消費者商品台幣${consumerRefund.cash}${!consumerRefund.hiCoin.isZero() ? ` + 嗨幣${consumerRefund.hiCoin}` : ""}`);
      details.push(`   運費 NT$${shippingAmount} 不退（消費者負擔寄送費）`);
      if (shippingAmount > 0) details.push(`   商家保留運費扣費後: ${newReceivableAfterRefund}`);
      details.push(`   商家扣回: ${merchantDebit}`);
      details.push(`   發票費 ${so.invoiceFeeAmount} 不退`);
      break;
    }

    case "negotiated":
    case "adjudicated": {
      const refundAmount = money(params.refundAmount || 500);
      const label = params.l4 === "adjudicated" ? "平台裁決退款" : "協商退款";
      const totalProduct = so.subOrderFinalItemAmount;
      const remainingRatio = totalProduct.isZero() ? ZERO : moneySub(totalProduct, refundAmount).dividedBy(totalProduct);
      const remainingHiCoin = Number(moneyMul(so.subOrderHiCoinAllocated, remainingRatio).floor().toString());
      const newSettlementBase = moneyRound(moneySub(so.subOrderSettlementBaseAmount, refundAmount));
      const remainingCalc = OrderCalculationService.calculate({
        products: [{ productName: "退款後剩餘", merchantId: m.id, originalPrice: Number(newSettlementBase.toString()), quantity: 1 }],
        coupons: [],
        hiCoinUsed: remainingHiCoin,
        shippingFees: { [m.id]: params.lShipping === "free_shipping" ? 0 : 80 },
        paymentFeeRate: isInstallment ? 0.035 : 0.02,
        merchantCommissions: { [m.id]: { storeRate: 0.03, categoryRate: 0.02 } },
      });
      const newSo = remainingCalc.subOrders[0];
      const newReceivable = newSo.merchantReceivableAmount;
      const merchantDebit = moneyRound(moneySub(receivable, newReceivable));
      const refundRatio = totalProduct.isZero() ? ZERO : refundAmount.dividedBy(totalProduct);
      const hiCoinRefund = hasHiCoin ? moneyMul(so.subOrderHiCoinAllocated, refundRatio).floor() : ZERO;
      const cashRefund = moneyRound(moneySub(refundAmount, hiCoinRefund));
      consumerRefund = { cash: cashRefund, hiCoin: hiCoinRefund };
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: merchantDebit.negated(),
        amountTaxIncl: merchantDebit.negated(), amountTaxExcl: merchantDebit.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
        idempotencyKey: `sim-negref-${subOrder.id}`, description: `${label} NT$${refundAmount}，重算結算基礎`,
      });
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        merchantReceivableAmount: moneyToString(newReceivable),
        availableSettlementAmount: moneyToString(newReceivable),
        subOrderSettlementBaseAmount: moneyToString(newSettlementBase),
        storeCommissionAmount: moneyToString(newSo.storeCommissionAmount),
        categoryCommissionAmount: moneyToString(newSo.categoryCommissionAmount),
        estimatedPaymentFeeAmount: moneyToString(newSo.estimatedPaymentFeeAmount),
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(newReceivable),
        reasonCode: params.l4 === "adjudicated" ? "ADJUDICATED_REFUND_RECALC" : "NEGOTIATED_REFUND_RECALC",
        reasonDetail: `${label} NT$${refundAmount}，結算基礎 ${so.subOrderSettlementBaseAmount} → ${newSettlementBase}`,
      } });
      details.push(`\n🤝 ${label}: 退消費者 NT$${refundAmount} (台幣${cashRefund}${!hiCoinRefund.isZero() ? ` + 嗨幣${hiCoinRefund}` : ""})`);
      details.push(`\n🔄 重算結算（結算基礎扣除退款金額）:`);
      details.push(`   結算基礎: ${so.subOrderSettlementBaseAmount} → ${newSettlementBase}`);
      details.push(`   商店抽成: ${so.storeCommissionAmount} → ${newSo.storeCommissionAmount}`);
      details.push(`   分類抽成: ${so.categoryCommissionAmount} → ${newSo.categoryCommissionAmount}`);
      details.push(`   金流費: ${so.estimatedPaymentFeeAmount} → ${newSo.estimatedPaymentFeeAmount} (基礎: ${newSo.paymentFeeBase})`);
      details.push(`   商家應得: ${receivable} → ${newReceivable}`);
      details.push(`   商家扣回: ${merchantDebit}`);
      details.push(`   發票費 ${so.invoiceFeeAmount} 不退${params.l4 === "adjudicated" ? " [平台裁決]" : ""}`);
      break;
    }

    case "partial_return": {
      if (so.items.length < 2) { details.push("\n⚠️ 單商品不支援部分退貨"); break; }
      const returnItem = so.items[0];
      const keepItem = so.items[1];
      const hiCoinRefund = returnItem.hiCoinAllocatedAmount;
      const cashRefund = moneyRound(moneySub(returnItem.finalPriceBeforeHiCoin, hiCoinRefund));
      consumerRefund = { cash: cashRefund, hiCoin: hiCoinRefund };
      const remainingCalc = OrderCalculationService.calculate({
        products: [{ productName: keepItem.productName, merchantId: m.id, originalPrice: Number(keepItem.finalPriceBeforeHiCoin.toString()), quantity: 1 }],
        coupons: [],
        hiCoinUsed: Number(keepItem.hiCoinAllocatedAmount.toString()),
        shippingFees: { [m.id]: params.lShipping === "free_shipping" ? 0 : 80 },
        paymentFeeRate: isInstallment ? 0.035 : 0.02,
        merchantCommissions: { [m.id]: { storeRate: 0.03, categoryRate: 0.02 } },
      });
      const newSo = remainingCalc.subOrders[0];
      const newReceivable = newSo.merchantReceivableAmount;
      const debitAmount = moneyRound(moneySub(receivable, newReceivable));
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: debitAmount.negated(),
        amountTaxIncl: debitAmount.negated(), amountTaxExcl: debitAmount.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER_ITEM, referenceId: subOrder.items[0].id,
        idempotencyKey: `sim-partret-${subOrder.items[0].id}`, description: `部分退貨: ${returnItem.productName}，重算剩餘商品`,
      });
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        merchantReceivableAmount: moneyToString(newReceivable),
        availableSettlementAmount: moneyToString(newReceivable),
        subOrderFinalItemAmount: moneyToString(newSo.subOrderFinalItemAmount),
        subOrderSettlementBaseAmount: moneyToString(newSo.subOrderSettlementBaseAmount),
        subOrderHiCoinAllocated: moneyToString(newSo.subOrderHiCoinAllocated),
        subOrderCashItemAmount: moneyToString(newSo.subOrderCashItemAmount),
        subOrderCashPaidAmount: moneyToString(newSo.subOrderCashPaidAmount),
        storeCommissionAmount: moneyToString(newSo.storeCommissionAmount),
        categoryCommissionAmount: moneyToString(newSo.categoryCommissionAmount),
        estimatedPaymentFeeAmount: moneyToString(newSo.estimatedPaymentFeeAmount),
        subOrderShippingFee: moneyToString(newSo.subOrderShippingFee),
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(newReceivable),
        reasonCode: "PARTIAL_RETURN_RECALC", reasonDetail: `部分退貨 ${returnItem.productName}，剩餘商品重算`,
      } });
      details.push(`\n📦 部分退貨: 退 ${returnItem.productName}，退消費者台幣${cashRefund}${!hiCoinRefund.isZero() ? ` + 嗨幣${hiCoinRefund}` : ""}`);
      details.push(`\n🔄 剩餘商品重算（${keepItem.productName}）:`);
      details.push(`   結算基礎: ${newSo.subOrderSettlementBaseAmount}`);
      details.push(`   商店抽成: ${newSo.storeCommissionAmount} | 分類抽成: ${newSo.categoryCommissionAmount}`);
      details.push(`   金流費: ${newSo.estimatedPaymentFeeAmount} (基礎: ${newSo.paymentFeeBase}) | 發票費: ${newSo.invoiceFeeAmount}`);
      details.push(`   運費: ${newSo.subOrderShippingFee}`);
      details.push(`   商家應得: ${receivable} → ${newReceivable}（重算後）`);
      details.push(`   商家扣回: ${debitAmount}`);
      break;
    }
  }

  const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
  details.push(`\n💰 商家 wallet: Pending ${bal.pending} | Available ${bal.available} | Reserved ${bal.reserved}`);

  return {
    orderNumber: order.orderNumber,
    details: details.join("\n"),
    consumerDebit: { cash: calc.cashTotalPaid.toString(), hiCoin: calc.hiCoinTotalUsed.toString() },
    consumerRefund: { cash: consumerRefund.cash.toString(), hiCoin: consumerRefund.hiCoin.toString() },
    // PRD v4: 額外資訊給前端
    isAmountConfirmed,
  };
}

// Reset
async function resetAll() {
  await prisma.settlementSnapshot.deleteMany();
  await prisma.walletBalanceSnapshot.deleteMany();
  await prisma.walletLedgerEntry.deleteMany();
  await prisma.payoutFailure.deleteMany();
  await prisma.payoutBatchItem.deleteMany();
  await prisma.payoutBatch.deleteMany();
  await prisma.payoutRequest.deleteMany();
  await prisma.disputeFreeze.deleteMany();
  await prisma.disputeEvidence.deleteMany();
  await prisma.disputeCase.deleteMany();
  await prisma.refundItem.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.subOrderPaymentAllocation.deleteMany();
  await prisma.subOrderItem.deleteMany();
  await prisma.subOrder.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.merchantWallet.updateMany({ data: { isFrozen: false, payoutSuspended: false, frozenReason: null } });
  await prisma.merchantBankAccount.deleteMany();
  const mA = await prisma.merchant.findFirst({ where: { taxId: "12345678" } });
  const mB = await prisma.merchant.findFirst({ where: { taxId: "87654321" } });
  if (mA) await prisma.merchantBankAccount.create({ data: { merchantId: mA.id, bankCode: "004", bankName: "台灣銀行", branchCode: "0012", branchName: "信義分行", accountNumber: "012345678901", accountName: "測試商家A有限公司", isActive: true } });
  if (mB) await prisma.merchantBankAccount.create({ data: { merchantId: mB.id, bankCode: "812", bankName: "台新銀行", branchCode: "0088", branchName: "南京分行", accountNumber: "987654321012", accountName: "測試商家B有限公司", isActive: true } });
  return { message: "已重置" };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "reset") return NextResponse.json({ success: true, ...(await resetAll()) });
    if (body.action === "execute") return NextResponse.json({ success: true, ...(await execute(body)) });
    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Simulator error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "失敗" }, { status: 500 });
  }
}

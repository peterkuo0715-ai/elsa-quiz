import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { DisputeService } from "@/server/services/dispute.service";
import { OrderCalculationService } from "@/server/services/order-calculation.service";
import {
  SubOrderStatus, SettlementStatus, DisputeStatus,
  WalletBucket, LedgerEntryType, ReferenceType, RefundType, RefundStatus, SnapshotType,
} from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyToString, ZERO } from "@/lib/money";
import { addDays } from "date-fns";
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
// ================================================================
interface ExecuteParams {
  l1: "single" | "multi";
  lShipping: "shipping_paid" | "free_shipping";
  l2: "cash" | "hicoin" | "hicoin_platform_coupon" | "hicoin_merchant_coupon";
  l3: "full_pay" | "installment";
  l4: "settled" | "pending" | "dispute" | "negotiated" | "full_refund" | "adjudicated" | "partial_return";
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
  const isInstallment = params.l3 === "installment";
  const paymentFeeRate = isInstallment ? 0.035 : 0.02;

  const products = isSingle
    ? [{ productName: "藍芽耳機", merchantId: m.id, originalPrice: 1500, memberPrice: 1400, quantity: 1 }]
    : [
        { productName: "藍芽耳機", merchantId: m.id, originalPrice: 1500, memberPrice: 1400, quantity: 1 },
        { productName: "耳機保護殼", merchantId: m.id, originalPrice: 500, campaignPrice: 450, quantity: 1 },
      ];

  const coupons = [];
  if (hasPlatformCoupon) coupons.push({ type: "PLATFORM" as const, amount: 100 });
  if (hasMerchantCoupon) coupons.push({ type: "MERCHANT" as const, amount: 100 });

  const hiCoinUsed = hasHiCoin ? 200 : 0;

  // === Run calculation engine (PRD Section 4) ===
  const calc = OrderCalculationService.calculate({
    products,
    coupons,
    hiCoinUsed,
    shippingFees: { [m.id]: params.lShipping === "free_shipping" ? 0 : 80 },
    paymentFeeRate,
    merchantCommissions: { [m.id]: { storeRate: 0.03, categoryRate: 0.02 } },
  });

  const so = calc.subOrders[0]; // single merchant → one sub-order

  // === Write to DB ===
  const isPending = params.l4 === "pending";
  const subOrderStatus = isPending ? SubOrderStatus.APPRECIATION_PERIOD : SubOrderStatus.SETTLEABLE;

  // Create Order
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
      paidAt: new Date(),
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

  // Create Payment Transaction
  await prisma.paymentTransaction.create({
    data: {
      orderId: order.id,
      paymentMethod: isInstallment ? "CREDIT_CARD_INSTALLMENT" : "CREDIT_CARD",
      paymentStatus: "SUCCESS",
      paymentFeeRateSnapshot: moneyToString(money(paymentFeeRate)),
      paymentAmount: moneyToString(calc.cashTotalPaid),
      estimatedPaymentFeeAmount: moneyToString(so.estimatedPaymentFeeAmount),
      paidAt: new Date(),
    },
  });

  // Create Sub-Order
  const subOrder = await prisma.subOrder.create({
    data: {
      orderId: order.id, merchantId: m.id,
      subOrderStatus,
      settlementStatus: isPending ? SettlementStatus.EXPECTED : SettlementStatus.AVAILABLE,
      appreciationPeriodStartAt: isPending ? new Date() : addDays(new Date(), -8),
      appreciationPeriodEndAt: isPending ? addDays(new Date(), 7) : addDays(new Date(), -1),
      expectedSettlementAmount: moneyToString(so.merchantReceivableAmount),
      availableSettlementAmount: isPending ? "0" : moneyToString(so.merchantReceivableAmount),
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
      reasonDetail: "付款成功，建立可預期獲利",
    },
  });

  // Ledger entries
  const receivable = so.merchantReceivableAmount;
  if (isPending) {
    const bd = { taxIncl: receivable, taxExcl: receivable, taxAmount: ZERO };
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.PENDING,
      entryType: LedgerEntryType.ORDER_PENDING_SETTLEMENT,
      amount: bd.taxIncl, amountTaxIncl: bd.taxIncl, amountTaxExcl: bd.taxExcl, taxAmount: bd.taxAmount,
      referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
      idempotencyKey: `sim-pend-${subOrder.id}`, description: `待結算: ${order.orderNumber}`,
    });
  } else {
    const bd = { taxIncl: receivable, taxExcl: receivable, taxAmount: ZERO };
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.SETTLEMENT_RELEASED,
      amount: bd.taxIncl, amountTaxIncl: bd.taxIncl, amountTaxExcl: bd.taxExcl, taxAmount: bd.taxAmount,
      referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
      idempotencyKey: `sim-settle-${subOrder.id}`, description: `結算入帳: ${order.orderNumber}`,
    });
  }

  // === L4 specific actions ===
  const details: string[] = [];
  let consumerRefund = { cash: ZERO, hiCoin: ZERO };

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
  details.push(`   金流費: ${so.estimatedPaymentFeeAmount} (基礎: 商品${so.subOrderFinalItemAmount}+運費${so.subOrderShippingFee}=${so.paymentFeeBase}) | 發票費: ${so.invoiceFeeAmount}(不可退) | 運費: ${so.subOrderShippingFee}`);
  details.push(`   商家應得: ${so.merchantReceivableAmount}${!so.platformAbsorbedAmount.isZero() ? ` (平台吸收${so.platformAbsorbedAmount})` : ""}`);

  switch (params.l4) {
    case "settled":
      details.push(`\n✅ 鑑賞期已過，商家應得 ${so.merchantReceivableAmount} 已入帳至 Available`);
      break;

    case "pending":
      details.push(`\n⏳ 鑑賞期中，商家應得 ${so.merchantReceivableAmount} 在 Pending，7天後結算`);
      break;

    case "dispute": {
      const freezeAmt = 500;
      const d = await prisma.disputeCase.create({
        data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, subOrderId: subOrder.id, disputeReason: "商品瑕疵爭議", disputeAmount: moneyToString(money(freezeAmt)), status: DisputeStatus.PARTIALLY_FROZEN },
      });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: String(freezeAmt) });
      details.push(`\n⚠️ 爭議中: ${d.caseNumber}，凍結 NT$${freezeAmt}`);
      break;
    }

    case "full_refund": {
      // Debit full merchant receivable from Available
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.REFUND_DEBIT, amount: receivable.negated(),
        amountTaxIncl: receivable.negated(), amountTaxExcl: receivable.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
        idempotencyKey: `sim-refund-${subOrder.id}`, description: `全額退款: ${order.orderNumber}`,
      });
      // Update sub_order: 金額歸零 + 狀態取消
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        subOrderStatus: SubOrderStatus.CANCELLED,
        merchantReceivableAmount: "0",
        availableSettlementAmount: "0",
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: "0",
        reasonCode: "FULL_REFUND", reasonDetail: "全額退款",
      } });
      // Consumer refund: cash + hicoin original path
      consumerRefund = { cash: so.subOrderCashPaidAmount, hiCoin: so.subOrderHiCoinAllocated };
      details.push(`\n🔄 全額退款: 退消費者台幣${consumerRefund.cash} + 嗨幣${consumerRefund.hiCoin}`);
      details.push(`   發票費 ${so.invoiceFeeAmount} 不退`);
      break;
    }

    case "negotiated":
    case "adjudicated": {
      const amount = money(params.refundAmount || 500);
      const label = params.l4 === "adjudicated" ? "平台裁決退款" : "協商退款";
      const totalProduct = so.subOrderFinalItemAmount;
      const ratio = totalProduct.isZero() ? ZERO : amount.dividedBy(totalProduct);

      // Merchant debit proportional to receivable
      const merchantDebit = moneyRound(moneyMul(receivable, ratio));
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: merchantDebit.negated(),
        amountTaxIncl: merchantDebit.negated(), amountTaxExcl: merchantDebit.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER, referenceId: subOrder.id,
        idempotencyKey: `sim-negref-${subOrder.id}`, description: `${label} NT$${amount}`,
      });

      // Consumer refund: proportional cash + hicoin
      const hiCoinRefund = hasHiCoin ? moneyRound(moneyMul(so.subOrderHiCoinAllocated, ratio)) : ZERO;
      const cashRefund = moneyRound(moneySub(amount, hiCoinRefund));
      consumerRefund = { cash: cashRefund, hiCoin: hiCoinRefund };

      // Update sub_order 金額
      const newReceivable1 = moneyRound(moneySub(receivable, merchantDebit));
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        merchantReceivableAmount: moneyToString(newReceivable1),
        availableSettlementAmount: moneyToString(newReceivable1),
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(newReceivable1),
        reasonCode: params.l4 === "adjudicated" ? "ADJUDICATED_REFUND" : "NEGOTIATED_REFUND",
        reasonDetail: `${label} NT$${amount}`,
      } });

      details.push(`\n🤝 ${label}: 退消費者 NT$${amount} (台幣${cashRefund}${!hiCoinRefund.isZero() ? ` + 嗨幣${hiCoinRefund}` : ""})`);
      details.push(`   商家扣回: ${merchantDebit}（按比例: ${amount}/${totalProduct} × 應得${receivable}）`);
      details.push(`   商家應得更新: ${receivable} → ${newReceivable1}`);
      details.push(`   發票費 ${so.invoiceFeeAmount} 不退${params.l4 === "adjudicated" ? " [平台裁決]" : ""}`);
      break;
    }

    case "partial_return": {
      if (so.items.length < 2) { details.push("\n⚠️ 單商品不支援部分退貨"); break; }
      const returnItem = so.items[0];
      const returnSoItem = subOrder.items[0];
      const itemRatio = returnItem.finalPriceBeforeHiCoin.dividedBy(so.subOrderFinalItemAmount);
      const merchantDebit = moneyRound(moneyMul(receivable, itemRatio));

      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: merchantDebit.negated(),
        amountTaxIncl: merchantDebit.negated(), amountTaxExcl: merchantDebit.negated(), taxAmount: ZERO,
        referenceType: ReferenceType.SUB_ORDER_ITEM, referenceId: returnSoItem.id,
        idempotencyKey: `sim-partret-${returnSoItem.id}`, description: `部分退貨: ${returnItem.productName}`,
      });

      const hiCoinRefund = returnItem.hiCoinAllocatedAmount;
      const cashRefund = moneyRound(moneySub(returnItem.finalPriceBeforeHiCoin, hiCoinRefund));
      consumerRefund = { cash: cashRefund, hiCoin: hiCoinRefund };

      // Update sub_order 金額
      const newReceivable2 = moneyRound(moneySub(receivable, merchantDebit));
      await prisma.subOrder.update({ where: { id: subOrder.id }, data: {
        merchantReceivableAmount: moneyToString(newReceivable2),
        availableSettlementAmount: moneyToString(newReceivable2),
      } });
      await prisma.settlementSnapshot.create({ data: {
        subOrderId: subOrder.id, snapshotType: SnapshotType.AVAILABLE_SETTLEMENT,
        amountBefore: moneyToString(receivable), amountAfter: moneyToString(newReceivable2),
        reasonCode: "PARTIAL_RETURN", reasonDetail: `部分退貨: ${returnItem.productName}`,
      } });

      details.push(`\n📦 部分退貨: 退 ${returnItem.productName}，退消費者台幣${cashRefund}${!hiCoinRefund.isZero() ? ` + 嗨幣${hiCoinRefund}` : ""}`);
      details.push(`   商家扣回: ${merchantDebit}`);
      details.push(`   商家應得更新: ${receivable} → ${newReceivable2}`);
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

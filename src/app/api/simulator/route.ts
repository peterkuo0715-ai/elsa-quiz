import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { RefundService } from "@/server/services/refund.service";
import { DisputeService } from "@/server/services/dispute.service";
import {
  SettlementItemStatus, DisputeStatus, WalletBucket, LedgerEntryType,
  ReferenceType, RefundType,
} from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyCeil, moneyToString, ZERO } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { addDays } from "date-fns";
import type { PrismaClient } from "@/generated/prisma";

const TX = () => prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
const PC = () => prisma as unknown as PrismaClient;
const uid = () => `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function getMerchantA() {
  const m = await prisma.merchant.findFirst({
    where: { taxId: "12345678" },
    include: { wallet: true, stores: true, bankAccounts: { where: { isActive: true } }, reserveRules: { where: { isActive: true } } },
  });
  if (!m || !m.wallet) throw new Error("Merchant A not found");
  return m;
}

// ================================================================
// Single execution endpoint: takes L1-L4 selections, runs full flow
// ================================================================
interface ExecuteParams {
  l1: "single" | "multi";          // 單商品 / 多商品
  l2: "cash" | "hicoin";           // 純台幣 / 台幣+嗨幣
  l3: "full_pay" | "installment";  // 一次付清 / 分期
  l4: "settled" | "pending" | "dispute" | "negotiated" | "full_refund" | "adjudicated" | "partial_return";
  refundAmount?: number;            // 協商/裁決退款金額
}

async function execute(params: ExecuteParams) {
  const m = await getMerchantA();
  const id = uid();

  // === Build order items based on L1 + L2 ===
  const isSingle = params.l1 === "single";
  const isHiCoin = params.l2 === "hicoin";
  const isInstallment = params.l3 === "installment";
  const commRate = 0.1;
  const payFeeRate = isInstallment ? 0.035 : 0.028; // 分期金流費較高
  const shipping = 80;

  const products = isSingle
    ? [{ name: "藍芽耳機", price: 1500, hiCoin: isHiCoin ? 200 : 0 }]
    : [
        { name: "藍芽耳機", price: 1500, hiCoin: isHiCoin ? 200 : 0 },
        { name: "耳機保護殼", price: 500, hiCoin: isHiCoin ? 100 : 0 },
      ];

  // === Create order + settlement items ===
  const orderItemsData = products.map((p) => {
    const bd = taxInclToBreakdown(p.price);
    const commission = moneyCeil(moneyMul(bd.taxExcl, commRate));
    const paymentFee = moneyCeil(moneyMul(bd.taxIncl, payFeeRate));
    const hiCoin = money(p.hiCoin);
    const cash = moneySub(bd.taxIncl, hiCoin);
    return {
      productName: p.name, sku: `SKU-${uid().slice(0, 6)}`, storeId: m.stores[0]?.id, quantity: 1,
      unitPriceTaxIncl: moneyToString(bd.taxIncl), unitPriceTaxExcl: moneyToString(bd.taxExcl), unitTaxAmount: moneyToString(bd.taxAmount),
      subtotalTaxIncl: moneyToString(bd.taxIncl), subtotalTaxExcl: moneyToString(bd.taxExcl), subtotalTaxAmount: moneyToString(bd.taxAmount),
      discountAmount: "0", discountedPriceTaxIncl: moneyToString(bd.taxIncl), discountedPriceTaxExcl: moneyToString(bd.taxExcl),
      platformCommissionRate: moneyToString(money(commRate)), platformCommission: moneyToString(commission),
      hiCoinAmount: moneyToString(hiCoin), cashAmount: moneyToString(cash),
      hiCoinMode: p.hiCoin > 0 ? "PLATFORM_SUBSIDY" : null, hiCoinCampaignCost: "0",
      paymentFeeRate: moneyToString(money(payFeeRate)), paymentFeeAmount: moneyToString(paymentFee),
      campaignId: null, campaignDiscount: "0",
      _commission: commission, _paymentFee: paymentFee, _hiCoin: hiCoin, _cash: cash, _bd: bd,
    };
  });

  const totalIncl = products.reduce((s, p) => s.plus(money(p.price)), ZERO);
  const totalHiCoin = products.reduce((s, p) => s.plus(money(p.hiCoin)), ZERO);
  const totalCash = moneySub(totalIncl, totalHiCoin).plus(money(shipping));
  const totalBd = taxInclToBreakdown(totalIncl);
  const shippingAmt = money(shipping);

  const order = await prisma.order.create({
    data: {
      id: `${id}-ord`, orderNumber: `ORD-${id}`, merchantId: m.id,
      totalAmountTaxIncl: moneyToString(totalBd.taxIncl), totalAmountTaxExcl: moneyToString(totalBd.taxExcl), totalTaxAmount: moneyToString(totalBd.taxAmount),
      shippingFeeTaxIncl: moneyToString(shippingAmt), shippingFeeTaxExcl: moneyToString(shippingAmt), shippingTaxAmount: "0",
      paymentMethod: isInstallment ? "信用卡分期" : "信用卡一次付清",
      paymentFee: "0", paidAt: new Date(),
      items: { create: orderItemsData.map(({ _commission, _paymentFee, _hiCoin, _cash, _bd, ...rest }) => rest) },
    },
    include: { items: true },
  });

  // Create settlement items
  const siList: Array<{ siId: string; netAmount: typeof ZERO; settlementBase: typeof ZERO; platformSubsidy: typeof ZERO; oiId: string; productName: string }> = [];

  for (let i = 0; i < order.items.length; i++) {
    const oi = order.items[i];
    const extra = orderItemsData[i];
    const productAmt = extra._bd.taxIncl;
    const itemShipping = i === 0 ? shippingAmt : ZERO;
    const commission = extra._commission;
    const paymentFee = extra._paymentFee;
    const hiCoin = extra._hiCoin;
    const platformSubsidy = hiCoin.isZero() ? ZERO : hiCoin;
    const settlementBase = moneyRound(productAmt.plus(itemShipping).minus(commission).minus(paymentFee));
    const netAmount = moneyRound(settlementBase.plus(platformSubsidy));
    const netBd = taxInclToBreakdown(netAmount);

    const isPending = params.l4 === "pending";
    const status = isPending ? SettlementItemStatus.IN_APPRECIATION_PERIOD : SettlementItemStatus.AVAILABLE_FOR_PAYOUT;

    const si = await prisma.settlementItem.create({
      data: {
        orderItemId: oi.id, merchantId: m.id, status,
        productAmount: moneyToString(productAmt), shippingAmount: moneyToString(itemShipping),
        commissionAmount: moneyToString(commission), commissionRate: moneyToString(money(commRate)),
        paymentFeeAmount: moneyToString(paymentFee),
        hiCoinRedeemedAmount: moneyToString(hiCoin), platformSubsidyAmount: moneyToString(platformSubsidy),
        cashPaidAmount: moneyToString(extra._cash), netSettlementAmount: moneyToString(netAmount),
        grossSettlementAmount: moneyToString(productAmt.plus(itemShipping).plus(platformSubsidy)),
        taxIncludedAmount: moneyToString(productAmt), taxExcludedAmount: moneyToString(extra._bd.taxExcl),
        itemAmountTaxIncl: moneyToString(productAmt), itemAmountTaxExcl: moneyToString(extra._bd.taxExcl), itemTaxAmount: moneyToString(extra._bd.taxAmount),
        netAmountTaxIncl: moneyToString(netBd.taxIncl), netAmountTaxExcl: moneyToString(netBd.taxExcl), netTaxAmount: moneyToString(netBd.taxAmount),
        paidAt: new Date(), shippedAt: addDays(new Date(), -1), deliveredAt: isPending ? new Date() : addDays(new Date(), -8),
        appreciationEndsAt: isPending ? addDays(new Date(), 7) : addDays(new Date(), -1),
        settledAt: isPending ? null : new Date(),
      },
    });

    // Ledger
    if (isPending) {
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.PENDING,
        entryType: LedgerEntryType.ORDER_PENDING_SETTLEMENT,
        amount: netBd.taxIncl, amountTaxIncl: netBd.taxIncl, amountTaxExcl: netBd.taxExcl, taxAmount: netBd.taxAmount,
        referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
        idempotencyKey: `sim-pend-${si.id}`, description: `待結算: ${oi.productName}`,
      });
    } else {
      const settlBd = taxInclToBreakdown(settlementBase);
      await LedgerService.createEntry(TX(), {
        walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.SETTLEMENT_RELEASED,
        amount: settlBd.taxIncl, amountTaxIncl: settlBd.taxIncl, amountTaxExcl: settlBd.taxExcl, taxAmount: settlBd.taxAmount,
        referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
        idempotencyKey: `sim-settle-${si.id}`, description: `結算入帳: ${oi.productName}`,
      });
      if (!platformSubsidy.isZero()) {
        const psBd = taxInclToBreakdown(platformSubsidy);
        await LedgerService.createEntry(TX(), {
          walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
          entryType: LedgerEntryType.HI_COIN_PLATFORM_SUBSIDY, amount: psBd.taxIncl,
          amountTaxIncl: psBd.taxIncl, amountTaxExcl: psBd.taxExcl, taxAmount: psBd.taxAmount,
          referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
          idempotencyKey: `sim-hcsub-${si.id}`, description: `平台嗨幣補貼 ${platformSubsidy}`,
        });
      }
    }

    siList.push({ siId: si.id, netAmount, settlementBase, platformSubsidy, oiId: oi.id, productName: oi.productName });
  }

  // === L4: Execute final state ===
  const details: string[] = [];
  let consumerRefund = { cash: ZERO, hiCoin: ZERO };

  details.push(`📋 訂單: ${order.orderNumber}`);
  details.push(`   商品: ${products.map(p => `${p.name} NT$${p.price}${p.hiCoin > 0 ? `(嗨幣${p.hiCoin})` : ""}`).join(" + ")} + 運費${shipping}`);
  details.push(`   付款: ${isHiCoin ? `台幣${totalCash} + 嗨幣${totalHiCoin}` : `台幣${totalCash}`} | ${isInstallment ? "信用卡分期" : "一次付清"} | 金流費${(payFeeRate * 100).toFixed(1)}%`);
  for (const s of siList) {
    const extra = orderItemsData.find(e => e.productName === s.productName)!;
    details.push(`   ${s.productName}: 商品${extra._bd.taxIncl} - 抽成${extra._commission} - 金流費${extra._paymentFee}${!s.platformSubsidy.isZero() ? ` + 補貼${s.platformSubsidy}` : ""} = 淨額${s.netAmount}`);
  }

  switch (params.l4) {
    case "settled":
      details.push(`✅ 鑑賞期已過，結算入帳至商家 Available`);
      break;

    case "pending":
      details.push(`⏳ 鑑賞期中，款項在 Pending，7天後可結算`);
      break;

    case "dispute": {
      const freezeAmt = 500;
      const d = await prisma.disputeCase.create({
        data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, orderId: order.id, disputeReason: "商品瑕疵爭議",
          disputeAmountTaxIncl: moneyToString(money(freezeAmt)), disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(freezeAmt).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(freezeAmt).taxAmount),
          status: DisputeStatus.PARTIALLY_FROZEN },
      });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: String(freezeAmt) });
      details.push(`⚠️ 爭議中: ${d.caseNumber}，凍結 NT$${freezeAmt}（僅爭議金額）`);
      break;
    }

    case "full_refund": {
      for (const s of siList) {
        const oi = order.items.find(o => o.id === s.oiId)!;
        const hiCoin = money(oi.hiCoinAmount.toString());
        const debitBd = taxInclToBreakdown(s.settlementBase);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: s.oiId, idempotencyKey: `sim-ref-${s.oiId}`, description: `全額退款: ${s.productName}` });
        if (!s.platformSubsidy.isZero()) {
          const hcBd = taxInclToBreakdown(s.platformSubsidy);
          await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: hcBd.taxIncl.negated(), amountTaxIncl: hcBd.taxIncl.negated(), amountTaxExcl: hcBd.taxExcl.negated(), taxAmount: hcBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: s.oiId, idempotencyKey: `sim-ref-hc-${s.oiId}`, description: `收回嗨幣補貼` });
        }
        await prisma.settlementItem.update({ where: { id: s.siId }, data: { status: SettlementItemStatus.REFUNDED } });
        consumerRefund.cash = consumerRefund.cash.plus(money(oi.cashAmount.toString()));
        consumerRefund.hiCoin = consumerRefund.hiCoin.plus(hiCoin);
      }
      consumerRefund.cash = consumerRefund.cash.plus(shippingAmt);
      details.push(`🔄 全額退款: 退消費者台幣 ${consumerRefund.cash} + 嗨幣 ${consumerRefund.hiCoin}`);
      break;
    }

    case "negotiated":
    case "adjudicated": {
      const amount = params.refundAmount || 1000;
      const isAdjudicated = params.l4 === "adjudicated";
      const label = isAdjudicated ? "平台裁決退款" : "協商退款";
      const totalProductAmt = products.reduce((s, p) => s.plus(money(p.price)), ZERO);
      const ratio = money(amount).dividedBy(totalProductAmt);

      // 按比例計算各項
      const totalSettlementBase = siList.reduce((s, si) => s.plus(si.settlementBase), ZERO);
      const totalSubsidy = siList.reduce((s, si) => s.plus(si.platformSubsidy), ZERO);
      const settlementDebit = moneyRound(moneyMul(totalSettlementBase, ratio));
      const subsidyDebit = moneyRound(moneyMul(totalSubsidy, ratio));

      // 消費者退款拆分
      const hiCoinRefund = isHiCoin ? moneyRound(moneyMul(totalHiCoin, ratio)) : ZERO;
      const cashRefund = moneyRound(moneySub(money(amount), hiCoinRefund));

      // 商家扣回: 結算部分
      const debitBd = taxInclToBreakdown(settlementDebit);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: siList[0].oiId, idempotencyKey: `sim-neg-${siList[0].oiId}`, description: `${label}: 扣回結算 ${settlementDebit}` });

      // 商家扣回: 嗨幣補貼
      if (!subsidyDebit.isZero()) {
        const subBd = taxInclToBreakdown(subsidyDebit);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: subBd.taxIncl.negated(), amountTaxIncl: subBd.taxIncl.negated(), amountTaxExcl: subBd.taxExcl.negated(), taxAmount: subBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: siList[0].oiId, idempotencyKey: `sim-neg-hc-${siList[0].oiId}`, description: `${label}: 收回補貼 ${subsidyDebit}` });
      }

      await prisma.settlementItem.update({ where: { id: siList[0].siId }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      consumerRefund = { cash: cashRefund, hiCoin: hiCoinRefund };
      details.push(`🤝 ${label}: 退消費者 NT$${amount} (台幣${cashRefund} + 嗨幣${hiCoinRefund})`);
      details.push(`   商家扣回: 結算${settlementDebit}${!subsidyDebit.isZero() ? ` + 補貼${subsidyDebit}` : ""} = 共${settlementDebit.plus(subsidyDebit)}${isAdjudicated ? " [平台裁決]" : ""}`);
      break;
    }

    case "partial_return": {
      if (siList.length < 2) { details.push("⚠️ 單商品不支援部分退貨"); break; }
      const returnItem = siList[0];
      const oi = order.items.find(o => o.id === returnItem.oiId)!;
      const hiCoin = money(oi.hiCoinAmount.toString());
      const debitBd = taxInclToBreakdown(returnItem.settlementBase);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: returnItem.oiId, idempotencyKey: `sim-partret-${returnItem.oiId}`, description: `部分退貨: ${returnItem.productName}` });
      if (!returnItem.platformSubsidy.isZero()) {
        const hcBd = taxInclToBreakdown(returnItem.platformSubsidy);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: hcBd.taxIncl.negated(), amountTaxIncl: hcBd.taxIncl.negated(), amountTaxExcl: hcBd.taxExcl.negated(), taxAmount: hcBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: returnItem.oiId, idempotencyKey: `sim-partret-hc-${returnItem.oiId}`, description: `收回嗨幣補貼` });
      }
      await prisma.settlementItem.update({ where: { id: returnItem.siId }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      consumerRefund = { cash: money(oi.cashAmount.toString()), hiCoin };
      details.push(`📦 部分退貨: 退 ${returnItem.productName} NT$${oi.subtotalTaxIncl}，退消費者台幣${consumerRefund.cash} + 嗨幣${consumerRefund.hiCoin}`);
      break;
    }
  }

  const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
  details.push(`商家 wallet: Pending ${bal.pending} | Available ${bal.available} | Reserved ${bal.reserved}`);

  return {
    orderNumber: order.orderNumber,
    details: details.join("\n"),
    consumerDebit: { cash: totalCash.toString(), hiCoin: totalHiCoin.toString() },
    consumerRefund: { cash: consumerRefund.cash.toString(), hiCoin: consumerRefund.hiCoin.toString() },
  };
}

// Reset
async function resetAll() {
  await prisma.monthlyStatementItem.deleteMany();
  await prisma.monthlyStatement.deleteMany();
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
  await prisma.settlementAdjustment.deleteMany();
  await prisma.settlementItem.deleteMany();
  await prisma.settlementBatch.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.merchantBankAccountChangeRequest.deleteMany();
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
    if (body.action === "execute") {
      const result = await execute(body);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Simulator error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "失敗" }, { status: 500 });
  }
}

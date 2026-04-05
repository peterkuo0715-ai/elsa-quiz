import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { PayoutService } from "@/server/services/payout.service";
import { RefundService } from "@/server/services/refund.service";
import { DisputeService } from "@/server/services/dispute.service";
import { ReserveService } from "@/server/services/reserve.service";
import {
  SettlementItemStatus, DisputeStatus, WalletBucket, LedgerEntryType,
  ReferenceType, RefundType, BankAccountChangeStatus,
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
// L1: Create Order (付款)
// ================================================================
async function createOrder(type: "cash" | "hicoin") {
  const m = await getMerchantA();
  const id = uid();

  const isCash = type === "cash";
  const items = isCash
    ? [
        { name: "藍芽耳機", price: 1500, qty: 1 },
        { name: "藍芽耳機保護殼", price: 500, qty: 1 },
      ]
    : [
        { name: "藍芽音箱", price: 1900, qty: 1 },
        { name: "藍芽音箱底座", price: 600, qty: 1 },
      ];

  const commRate = 0.1;
  const payFeeRate = 0.028;
  const shipping = 80;
  const hiCoinPerItem = isCash ? 0 : 200;

  const orderItemsData = items.map((item) => {
    const bd = taxInclToBreakdown(item.price);
    const commission = moneyCeil(moneyMul(bd.taxExcl, commRate));
    const paymentFee = moneyCeil(moneyMul(bd.taxIncl, payFeeRate));
    const hiCoin = money(hiCoinPerItem);
    const cash = moneySub(bd.taxIncl, hiCoin);

    return {
      productName: item.name, sku: `SKU-${uid().slice(0, 6)}`, storeId: m.stores[0]?.id, quantity: item.qty,
      unitPriceTaxIncl: moneyToString(bd.taxIncl), unitPriceTaxExcl: moneyToString(bd.taxExcl), unitTaxAmount: moneyToString(bd.taxAmount),
      subtotalTaxIncl: moneyToString(bd.taxIncl), subtotalTaxExcl: moneyToString(bd.taxExcl), subtotalTaxAmount: moneyToString(bd.taxAmount),
      discountAmount: "0", discountedPriceTaxIncl: moneyToString(bd.taxIncl), discountedPriceTaxExcl: moneyToString(bd.taxExcl),
      platformCommissionRate: moneyToString(money(commRate)), platformCommission: moneyToString(commission),
      hiCoinAmount: moneyToString(hiCoin), cashAmount: moneyToString(cash),
      hiCoinMode: hiCoinPerItem > 0 ? "PLATFORM_SUBSIDY" : null, hiCoinCampaignCost: "0",
      paymentFeeRate: moneyToString(money(payFeeRate)), paymentFeeAmount: moneyToString(paymentFee),
      campaignId: null, campaignDiscount: "0",
      _commission: commission, _paymentFee: paymentFee, _hiCoin: hiCoin, _cash: cash, _bd: bd,
    };
  });

  const totalIncl = items.reduce((s, i) => s.plus(money(i.price)), ZERO);
  const totalBd = taxInclToBreakdown(totalIncl);
  const totalHiCoin = money(hiCoinPerItem * items.length);
  const totalCash = moneySub(totalIncl, totalHiCoin);
  const shippingAmt = money(shipping);

  const order = await prisma.order.create({
    data: {
      id: `${id}-ord`, orderNumber: `ORD-${id}`, merchantId: m.id,
      totalAmountTaxIncl: moneyToString(totalBd.taxIncl), totalAmountTaxExcl: moneyToString(totalBd.taxExcl), totalTaxAmount: moneyToString(totalBd.taxAmount),
      shippingFeeTaxIncl: moneyToString(shippingAmt), shippingFeeTaxExcl: moneyToString(shippingAmt), shippingTaxAmount: "0",
      paymentFee: "0", paidAt: new Date(),
      items: { create: orderItemsData.map(({ _commission, _paymentFee, _hiCoin, _cash, _bd, ...rest }) => rest) },
    },
    include: { items: true },
  });

  // Create settlement items (IN_APPRECIATION_PERIOD)
  const siIds: string[] = [];
  for (let i = 0; i < order.items.length; i++) {
    const oi = order.items[i];
    const extra = orderItemsData[i];
    const productAmt = extra._bd.taxIncl;
    const itemShipping = i === 0 ? shippingAmt : ZERO; // shipping only on first item
    const commission = extra._commission;
    const paymentFee = extra._paymentFee;
    const hiCoin = extra._hiCoin;
    const platformSubsidy = hiCoin.isZero() ? ZERO : hiCoin;
    const settlementBase = moneyRound(productAmt.plus(itemShipping).minus(commission).minus(paymentFee));
    const netAmount = moneyRound(settlementBase.plus(platformSubsidy));
    const netBd = taxInclToBreakdown(netAmount);

    const si = await prisma.settlementItem.create({
      data: {
        orderItemId: oi.id, merchantId: m.id, status: SettlementItemStatus.IN_APPRECIATION_PERIOD,
        productAmount: moneyToString(productAmt), shippingAmount: moneyToString(itemShipping),
        commissionAmount: moneyToString(commission), commissionRate: moneyToString(money(commRate)),
        paymentFeeAmount: moneyToString(paymentFee),
        hiCoinRedeemedAmount: moneyToString(hiCoin), platformSubsidyAmount: moneyToString(platformSubsidy),
        cashPaidAmount: moneyToString(extra._cash), netSettlementAmount: moneyToString(netAmount),
        grossSettlementAmount: moneyToString(productAmt.plus(itemShipping).plus(platformSubsidy)),
        taxIncludedAmount: moneyToString(productAmt), taxExcludedAmount: moneyToString(extra._bd.taxExcl),
        itemAmountTaxIncl: moneyToString(productAmt), itemAmountTaxExcl: moneyToString(extra._bd.taxExcl), itemTaxAmount: moneyToString(extra._bd.taxAmount),
        netAmountTaxIncl: moneyToString(netBd.taxIncl), netAmountTaxExcl: moneyToString(netBd.taxExcl), netTaxAmount: moneyToString(netBd.taxAmount),
        paidAt: new Date(), shippedAt: addDays(new Date(), -1), deliveredAt: new Date(),
        appreciationEndsAt: addDays(new Date(), 7),
      },
    });

    // Ledger: pending
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.PENDING,
      entryType: LedgerEntryType.ORDER_PENDING_SETTLEMENT,
      amount: netBd.taxIncl, amountTaxIncl: netBd.taxIncl, amountTaxExcl: netBd.taxExcl, taxAmount: netBd.taxAmount,
      referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
      idempotencyKey: `sim-pend-${si.id}`, description: `待結算: ${oi.productName}`,
    });
    siIds.push(si.id);
  }

  return {
    orderId: order.id, orderNumber: order.orderNumber, siIds,
    totalCash: totalCash.plus(shippingAmt).toString(), totalHiCoin: totalHiCoin.toString(),
    items: items.map((it, i) => `${it.name} NT$${it.price}`).join(" + ") + ` + 運費${shipping}`,
    consumerDebit: { cash: totalCash.plus(shippingAmt).toString(), hiCoin: totalHiCoin.toString() },
  };
}

// ================================================================
// L2: Change order state
// ================================================================
async function settleOrder(orderId: string) {
  const m = await getMerchantA();
  const items = await prisma.settlementItem.findMany({
    where: { orderItem: { orderId }, status: SettlementItemStatus.IN_APPRECIATION_PERIOD },
    include: { orderItem: true },
  });
  if (items.length === 0) return { message: "無可結算項目" };

  for (const si of items) {
    const netBd = taxInclToBreakdown(money(si.netSettlementAmount.toString()));
    const settlementBase = moneyRound(money(si.netSettlementAmount.toString()).minus(money(si.platformSubsidyAmount.toString())));
    const settlBd = taxInclToBreakdown(settlementBase);
    const platformSubsidy = money(si.platformSubsidyAmount.toString());

    // Move pending → available (base)
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.PENDING,
      entryType: LedgerEntryType.SETTLEMENT_RELEASED, amount: netBd.taxIncl.negated(),
      amountTaxIncl: netBd.taxIncl.negated(), amountTaxExcl: netBd.taxExcl.negated(), taxAmount: netBd.taxAmount.negated(),
      referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
      idempotencyKey: `sim-rel-p-${si.id}`, description: "結算: pending 扣除",
    });
    await LedgerService.createEntry(TX(), {
      walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE,
      entryType: LedgerEntryType.SETTLEMENT_RELEASED, amount: settlBd.taxIncl,
      amountTaxIncl: settlBd.taxIncl, amountTaxExcl: settlBd.taxExcl, taxAmount: settlBd.taxAmount,
      referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
      idempotencyKey: `sim-rel-a-${si.id}`, description: `結算入帳: ${si.orderItem.productName}`,
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
    // Reserve
    if (m.reserveRules.length > 0) {
      const pct = money(m.reserveRules[0].reservePercent.toString());
      const resAmt = moneyRound(moneyMul(money(si.netSettlementAmount.toString()), pct));
      if (!resAmt.isZero()) {
        const rb = taxInclToBreakdown(resAmt);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl.negated(), amountTaxIncl: rb.taxIncl.negated(), amountTaxExcl: rb.taxExcl.negated(), taxAmount: rb.taxAmount.negated(), referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id, idempotencyKey: `sim-res-a-${si.id}`, description: "Reserve 扣留" });
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.RESERVED, entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl, amountTaxIncl: rb.taxIncl, amountTaxExcl: rb.taxExcl, taxAmount: rb.taxAmount, referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id, idempotencyKey: `sim-res-r-${si.id}`, description: "Reserve 入帳" });
        await prisma.settlementItem.update({ where: { id: si.id }, data: { reserveAmount: moneyToString(resAmt) } });
      }
    }
    await prisma.settlementItem.update({
      where: { id: si.id },
      data: { status: SettlementItemStatus.AVAILABLE_FOR_PAYOUT, settledAt: new Date(), deliveredAt: addDays(new Date(), -8), appreciationEndsAt: addDays(new Date(), -1) },
    });
  }
  const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
  return { message: `結算完成，${items.length} 筆入帳。Available: ${bal.available}`, merchantAvailable: bal.available.toString() };
}

// ================================================================
// L3: Operations
// ================================================================
async function runL3(action: string, orderId: string) {
  const m = await getMerchantA();
  const orderItems = await prisma.orderItem.findMany({ where: { orderId }, include: { settlementItem: true } });
  if (orderItems.length === 0) return { error: "訂單不存在" };

  switch (action) {
    // --- Refund in appreciation period ---
    case "refund_in_appreciation": {
      const totalRefund = orderItems.reduce((s, oi) => s.plus(money(oi.subtotalTaxIncl.toString())), ZERO);
      const totalHiCoin = orderItems.reduce((s, oi) => s.plus(money(oi.hiCoinAmount.toString())), ZERO);
      const totalCash = moneySub(totalRefund, totalHiCoin);
      // Remove from pending
      for (const oi of orderItems) {
        if (oi.settlementItem) {
          const net = money(oi.settlementItem.netSettlementAmount.toString());
          const netBd = taxInclToBreakdown(net);
          await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.PENDING, entryType: LedgerEntryType.REFUND_DEBIT, amount: netBd.taxIncl.negated(), amountTaxIncl: netBd.taxIncl.negated(), amountTaxExcl: netBd.taxExcl.negated(), taxAmount: netBd.taxAmount.negated(), referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: oi.settlementItem.id, idempotencyKey: `sim-refpend-${oi.settlementItem.id}`, description: "鑑賞期內退款，取消待結算" });
          await prisma.settlementItem.update({ where: { id: oi.settlementItem.id }, data: { status: SettlementItemStatus.REFUNDED } });
        }
      }
      return { message: `鑑賞期內退款完成。退消費者: 台幣${totalCash} + 嗨幣${totalHiCoin}`, consumerRefund: { cash: totalCash.toString(), hiCoin: totalHiCoin.toString() } };
    }

    // --- Partial refund (退第一件) ---
    case "partial_refund": {
      const oi = orderItems[0];
      const refundAmt = money(oi.subtotalTaxIncl.toString());
      const hiCoinRefund = money(oi.hiCoinAmount.toString());
      const cashRefund = moneySub(refundAmt, hiCoinRefund);
      const comm = moneyCeil(money(oi.platformCommission.toString()));
      const si = oi.settlementItem!;
      const settlementBase = moneyRound(money(si.netSettlementAmount.toString()).minus(money(si.platformSubsidyAmount.toString())));
      // Debit settlement base
      const debitBd = taxInclToBreakdown(settlementBase);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-partref-${oi.id}`, description: `部分退貨: ${oi.productName}` });
      if (!hiCoinRefund.isZero()) {
        const hcBd = taxInclToBreakdown(hiCoinRefund);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: hcBd.taxIncl.negated(), amountTaxIncl: hcBd.taxIncl.negated(), amountTaxExcl: hcBd.taxExcl.negated(), taxAmount: hcBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-partref-hc-${oi.id}`, description: `收回嗨幣補貼 ${hiCoinRefund}` });
      }
      await prisma.settlementItem.update({ where: { id: si.id }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `部分退貨: ${oi.productName} NT$${refundAmt}。退消費者台幣${cashRefund}+嗨幣${hiCoinRefund}。抽成${comm}退還，金流費不退。商家Available: ${bal.available}`, consumerRefund: { cash: cashRefund.toString(), hiCoin: hiCoinRefund.toString() } };
    }

    // --- Full refund ---
    case "full_refund": {
      let totalCashRefund = ZERO, totalHiCoinRefund = ZERO;
      for (const oi of orderItems) {
        const si = oi.settlementItem!;
        const hiCoin = money(oi.hiCoinAmount.toString());
        const cash = money(oi.cashAmount.toString());
        totalCashRefund = totalCashRefund.plus(cash);
        totalHiCoinRefund = totalHiCoinRefund.plus(hiCoin);
        const settlementBase = moneyRound(money(si.netSettlementAmount.toString()).minus(money(si.platformSubsidyAmount.toString())));
        const debitBd = taxInclToBreakdown(settlementBase);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-fullref-${oi.id}`, description: `全額退款: ${oi.productName}` });
        if (!hiCoin.isZero()) {
          const hcBd = taxInclToBreakdown(hiCoin);
          await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: hcBd.taxIncl.negated(), amountTaxIncl: hcBd.taxIncl.negated(), amountTaxExcl: hcBd.taxExcl.negated(), taxAmount: hcBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-fullref-hc-${oi.id}`, description: `收回嗨幣補貼 ${hiCoin}` });
        }
        await prisma.settlementItem.update({ where: { id: si.id }, data: { status: SettlementItemStatus.REFUNDED } });
      }
      // Add shipping refund
      const shippingRefund = money((await prisma.order.findUnique({ where: { id: orderId } }))!.shippingFeeTaxIncl.toString());
      totalCashRefund = totalCashRefund.plus(shippingRefund);
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `全額退款完成。退消費者台幣${totalCashRefund}+嗨幣${totalHiCoinRefund}。商家Available: ${bal.available}`, consumerRefund: { cash: totalCashRefund.toString(), hiCoin: totalHiCoinRefund.toString() } };
    }

    // --- Negotiated refund (協商退款 1000) ---
    case "negotiated_refund": {
      const negotiatedAmount = 1000;
      const oi = orderItems[0];
      const si = oi.settlementItem!;
      const hiCoin = money(oi.hiCoinAmount.toString());
      // Proportion of negotiated to original
      const originalAmt = money(oi.subtotalTaxIncl.toString());
      const ratio = money(negotiatedAmount).dividedBy(originalAmt);
      const hiCoinPortion = moneyRound(moneyMul(hiCoin, ratio));
      const cashPortion = moneyRound(moneySub(money(negotiatedAmount), hiCoinPortion));
      const comm = moneyCeil(moneyMul(money(oi.platformCommission.toString()), ratio));
      // Debit from merchant: negotiatedAmount - commission (payment fee not returned)
      const merchantDebit = moneyRound(moneySub(money(negotiatedAmount), comm));
      const debitBd = taxInclToBreakdown(merchantDebit);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.PARTIAL_REFUND_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-negref-${oi.id}`, description: `協商退款 NT$${negotiatedAmount}` });
      await prisma.settlementItem.update({ where: { id: si.id }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `協商退款: 退消費者 NT$${negotiatedAmount} (台幣${cashPortion}+嗨幣${hiCoinPortion})。抽成退${comm}，金流費不退。商家Available: ${bal.available}`, consumerRefund: { cash: cashPortion.toString(), hiCoin: hiCoinPortion.toString() } };
    }

    // --- Dispute freeze → resolve ---
    case "dispute_resolve": {
      const freezeAmt = 500;
      const d = await prisma.disputeCase.create({ data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, orderId, disputeReason: "商品瑕疵爭議", disputeAmountTaxIncl: moneyToString(money(freezeAmt)), disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(freezeAmt).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(freezeAmt).taxAmount), status: DisputeStatus.OPENED } });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: String(freezeAmt) });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.PARTIALLY_FROZEN } });
      await DisputeService.unfreezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.RESOLVED, resolution: "商家勝訴", resolvedAt: new Date() } });
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `爭議 ${d.caseNumber}: 凍結 NT$${freezeAmt} → 商家勝訴 → 解凍回 Available。商家Available: ${bal.available}` };
    }

    // --- Dispute freeze → debit ---
    case "dispute_debit": {
      const freezeAmt = 500;
      const d = await prisma.disputeCase.create({ data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, orderId, disputeReason: "商品嚴重瑕疵", disputeAmountTaxIncl: moneyToString(money(freezeAmt)), disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(freezeAmt).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(freezeAmt).taxAmount), status: DisputeStatus.OPENED } });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: String(freezeAmt) });
      await DisputeService.debitDisputedAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.REJECTED, resolution: "商家敗訴", resolvedAt: new Date() } });
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `爭議 ${d.caseNumber}: 凍結 NT$${freezeAmt} → 商家敗訴 → 永久扣回。商家Available: ${bal.available}` };
    }

    // --- Payout success ---
    case "payout_success": {
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal.available.isZero() || bal.available.isNegative()) return { error: "無可提領餘額" };
      const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: bal.available.toString(), requestedBy: "simulator" });
      await PayoutService.handleSuccess(PC(), p.id);
      return { message: `提領成功: NT$${bal.available} 已匯出`, merchantPayout: bal.available.toString() };
    }

    // --- Payout failure ---
    case "payout_failure": {
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal.available.isZero() || bal.available.isNegative()) return { error: "無可提領餘額" };
      const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: bal.available.toString(), requestedBy: "simulator" });
      await PayoutService.handleFailure(PC(), p.id, "銀行帳號無效");
      const balAfter = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `提領失敗: NT$${bal.available} 已自動退回 wallet。Available: ${balAfter.available}` };
    }

    // --- Reserve release ---
    case "reserve_release": {
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal.reserved.isZero()) return { error: "無 Reserve 可釋放" };
      await ReserveService.releaseReserve(PC(), { walletId: m.wallet!.id, amountTaxIncl: bal.reserved.toString(), reserveRuleId: "sim-release", reason: "模擬釋放" });
      const balAfter = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `Reserve NT$${bal.reserved} 已釋放。Available: ${balAfter.available}` };
    }

    // --- Post-payout refund (negative balance) ---
    case "negative_balance_refund": {
      // First payout all available
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal.available.isPositive()) {
        const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: bal.available.toString(), requestedBy: "simulator" });
        await PayoutService.handleSuccess(PC(), p.id);
      }
      // Then refund all items
      for (const oi of orderItems) {
        const si = oi.settlementItem;
        if (!si || si.status === SettlementItemStatus.REFUNDED) continue;
        const net = money(si.netSettlementAmount.toString());
        const netBd = taxInclToBreakdown(net);
        await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.NEGATIVE_BALANCE_CARRY, amount: netBd.taxIncl.negated(), amountTaxIncl: netBd.taxIncl.negated(), amountTaxExcl: netBd.taxExcl.negated(), taxAmount: netBd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: oi.id, idempotencyKey: `sim-negbal-${oi.id}`, description: `已提領後退款 → 負餘額` });
        await prisma.settlementItem.update({ where: { id: si.id }, data: { status: SettlementItemStatus.REFUNDED } });
      }
      await prisma.merchantWallet.update({ where: { id: m.wallet!.id }, data: { payoutSuspended: true } });
      const balAfter = await LedgerService.getBalances(TX(), m.wallet!.id);
      const totalRefundCash = orderItems.reduce((s, oi) => s.plus(money(oi.cashAmount.toString())), ZERO);
      const totalRefundHiCoin = orderItems.reduce((s, oi) => s.plus(money(oi.hiCoinAmount.toString())), ZERO);
      return { message: `已提領後退款! 商家Available: ${balAfter.available}（負餘額），提領已暫停`, consumerRefund: { cash: totalRefundCash.toString(), hiCoin: totalRefundHiCoin.toString() } };
    }

    // --- Manual adjustment ---
    case "manual_adjustment": {
      const c = taxInclToBreakdown(300);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_CREDIT, amount: c.taxIncl, amountTaxIncl: c.taxIncl, amountTaxExcl: c.taxExcl, taxAmount: c.taxAmount, referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-c-${uid()}`, description: "手動補發 NT$300" });
      const d = taxInclToBreakdown(100);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_DEBIT, amount: d.taxIncl.negated(), amountTaxIncl: d.taxIncl.negated(), amountTaxExcl: d.taxExcl.negated(), taxAmount: d.taxAmount.negated(), referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-d-${uid()}`, description: "手動扣回 NT$100" });
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `手動調整: 補發+300 扣回-100 = 淨增200。Available: ${bal.available}` };
    }

    default:
      return { error: `未知操作: ${action}` };
  }
}

// ================================================================
// Reset
// ================================================================
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

// ================================================================
// Router
// ================================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, type, orderId } = body;

    if (action === "reset") return NextResponse.json({ success: true, ...(await resetAll()) });
    if (action === "create_order") return NextResponse.json({ success: true, ...(await createOrder(type)) });
    if (action === "settle") return NextResponse.json({ success: true, ...(await settleOrder(orderId)) });
    if (action && orderId) return NextResponse.json({ success: true, ...(await runL3(action, orderId)) });

    return NextResponse.json({ success: false, message: "Missing action" }, { status: 400 });
  } catch (error) {
    console.error("Simulator error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "失敗" }, { status: 500 });
  }
}

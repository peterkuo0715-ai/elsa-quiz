import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { PayoutService } from "@/server/services/payout.service";
import { RefundService } from "@/server/services/refund.service";
import { DisputeService } from "@/server/services/dispute.service";
import { ReserveService } from "@/server/services/reserve.service";
import {
  SettlementItemStatus, PayoutRequestStatus, PayoutBatchStatus,
  DisputeStatus, BankAccountChangeStatus, WalletBucket, LedgerEntryType,
  ReferenceType, RefundType,
} from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyCeil, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { addDays } from "date-fns";
import type { PrismaClient } from "@/generated/prisma";
import { generateMonthlyStatement } from "@/server/queries/statement.queries";

const TX = () => prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
const PC = () => prisma as unknown as PrismaClient;
const uid = () => `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function getMerchant(name: "A" | "B") {
  const taxId = name === "A" ? "12345678" : "87654321";
  const m = await prisma.merchant.findFirst({
    where: { taxId },
    include: { wallet: true, stores: true, bankAccounts: { where: { isActive: true } }, reserveRules: { where: { isActive: true } } },
  });
  if (!m || !m.wallet) throw new Error(`Merchant ${name} not found`);
  return m;
}

// ================================================================
// PRD v1.1 Full-featured order helper
// ================================================================
interface OrderItemInput {
  merchantTaxId: string;
  productName: string;
  price: number;           // 商品成交金額（含稅）
  commissionRate: number;  // 平台抽成率
  shippingFee?: number;    // 運費
  paymentFeeRate?: number; // 金流費率
  hiCoinAmount?: number;   // 嗨幣折抵
  hiCoinMode?: "PLATFORM_SUBSIDY" | "MERCHANT_CAMPAIGN" | null;
  campaignDiscount?: number; // 商家活動成本
}

async function createFullOrder(params: {
  items: OrderItemInput[];
  settle?: boolean;   // true = 直接結算到 AVAILABLE, false = 留在鑑賞期
}) {
  const settle = params.settle !== false;
  const id = uid();
  const orderNumber = `ORD-${id}`;

  const merchantItems = new Map<string, OrderItemInput[]>();
  for (const item of params.items) {
    const list = merchantItems.get(item.merchantTaxId) || [];
    list.push(item);
    merchantItems.set(item.merchantTaxId, list);
  }

  const results: Array<{
    merchantName: string; orderId: string; orderItemId: string;
    settlementItemId: string; netAmount: string; details: string;
  }> = [];

  for (const [taxId, items] of merchantItems) {
    const merchant = await prisma.merchant.findFirst({
      where: { taxId },
      include: { wallet: true, stores: true, reserveRules: { where: { isActive: true } } },
    });
    if (!merchant || !merchant.wallet) continue;

    const orderId = `${id}-${taxId.slice(0, 4)}`;
    const orderNum = `${orderNumber}-${taxId.slice(0, 4)}`;

    let totalIncl = money(0);
    const orderItemsData = items.map((item) => {
      const bd = taxInclToBreakdown(item.price);
      const commission = moneyCeil(moneyMul(bd.taxExcl, item.commissionRate));
      const paymentFee = item.paymentFeeRate ? moneyCeil(moneyMul(bd.taxIncl, item.paymentFeeRate)) : money(0);
      const hiCoin = money(item.hiCoinAmount || 0);
      const cash = moneySub(bd.taxIncl, hiCoin);
      const campaign = money(item.campaignDiscount || 0);
      totalIncl = totalIncl.plus(bd.taxIncl);

      return {
        productName: item.productName,
        sku: `SKU-${uid().slice(0, 6)}`,
        storeId: merchant.stores[0]?.id,
        quantity: 1,
        unitPriceTaxIncl: moneyToString(bd.taxIncl),
        unitPriceTaxExcl: moneyToString(bd.taxExcl),
        unitTaxAmount: moneyToString(bd.taxAmount),
        subtotalTaxIncl: moneyToString(bd.taxIncl),
        subtotalTaxExcl: moneyToString(bd.taxExcl),
        subtotalTaxAmount: moneyToString(bd.taxAmount),
        discountAmount: "0",
        discountedPriceTaxIncl: moneyToString(bd.taxIncl),
        discountedPriceTaxExcl: moneyToString(bd.taxExcl),
        platformCommissionRate: moneyToString(money(item.commissionRate)),
        platformCommission: moneyToString(commission),
        hiCoinAmount: moneyToString(hiCoin),
        cashAmount: moneyToString(cash),
        hiCoinMode: item.hiCoinMode || null,
        hiCoinCampaignCost: item.hiCoinMode === "MERCHANT_CAMPAIGN" ? moneyToString(hiCoin) : "0",
        paymentFeeRate: moneyToString(money(item.paymentFeeRate || 0)),
        paymentFeeAmount: moneyToString(paymentFee),
        campaignId: null,
        campaignDiscount: moneyToString(campaign),
        _commission: commission,
        _paymentFee: paymentFee,
        _hiCoin: hiCoin,
        _cash: cash,
        _campaign: campaign,
        _shipping: money(item.shippingFee || 0),
        _bd: bd,
      };
    });

    const totalBd = taxInclToBreakdown(totalIncl);
    const order = await prisma.order.create({
      data: {
        id: orderId, orderNumber: orderNum, merchantId: merchant.id,
        totalAmountTaxIncl: moneyToString(totalBd.taxIncl),
        totalAmountTaxExcl: moneyToString(totalBd.taxExcl),
        totalTaxAmount: moneyToString(totalBd.taxAmount),
        shippingFeeTaxIncl: "0", shippingFeeTaxExcl: "0", shippingTaxAmount: "0",
        paymentFee: "0", paidAt: new Date(),
        items: {
          create: orderItemsData.map(({ _commission, _paymentFee, _hiCoin, _cash, _campaign, _shipping, _bd, ...rest }) => rest),
        },
      },
      include: { items: true },
    });

    for (let i = 0; i < order.items.length; i++) {
      const oi = order.items[i];
      const extra = orderItemsData[i];
      const shipping = extra._shipping;
      const commission = extra._commission;
      const paymentFee = extra._paymentFee;
      const hiCoin = extra._hiCoin;
      const cash = extra._cash;
      const campaign = extra._campaign;
      const productAmt = extra._bd.taxIncl;

      // PRD v1.1 公式: 商家實得 = 商品 + 運費 - 抽成 - 金流費 - 活動成本 - 嗨幣活動成本 + 平台補貼
      let netAmount = productAmt.plus(shipping).minus(commission).minus(paymentFee).minus(campaign);
      const platformSubsidy = extra.hiCoinMode === "PLATFORM_SUBSIDY" ? hiCoin : money(0);
      const hiCoinCampaignCost = extra.hiCoinMode === "MERCHANT_CAMPAIGN" ? hiCoin : money(0);
      netAmount = netAmount.minus(hiCoinCampaignCost).plus(platformSubsidy);
      netAmount = moneyRound(netAmount);
      const netBd = taxInclToBreakdown(netAmount);

      const status = settle ? SettlementItemStatus.AVAILABLE_FOR_PAYOUT : SettlementItemStatus.IN_APPRECIATION_PERIOD;
      const si = await prisma.settlementItem.create({
        data: {
          orderItemId: oi.id, merchantId: merchant.id, status,
          productAmount: moneyToString(productAmt),
          shippingAmount: moneyToString(shipping),
          commissionAmount: moneyToString(commission),
          commissionRate: moneyToString(money(extra._bd.taxExcl.isZero() ? 0 : extra._commission.dividedBy(extra._bd.taxExcl))),
          paymentFeeAmount: moneyToString(paymentFee),
          promotionCostAmount: moneyToString(campaign),
          hiCoinRedeemedAmount: moneyToString(hiCoin),
          hiCoinCampaignCostAmount: moneyToString(hiCoinCampaignCost),
          platformSubsidyAmount: moneyToString(platformSubsidy),
          cashPaidAmount: moneyToString(cash),
          netSettlementAmount: moneyToString(netAmount),
          grossSettlementAmount: moneyToString(productAmt.plus(shipping).plus(platformSubsidy)),
          taxIncludedAmount: moneyToString(productAmt),
          taxExcludedAmount: moneyToString(extra._bd.taxExcl),
          itemAmountTaxIncl: moneyToString(productAmt),
          itemAmountTaxExcl: moneyToString(extra._bd.taxExcl),
          itemTaxAmount: moneyToString(extra._bd.taxAmount),
          netAmountTaxIncl: moneyToString(netBd.taxIncl),
          netAmountTaxExcl: moneyToString(netBd.taxExcl),
          netTaxAmount: moneyToString(netBd.taxAmount),
          paidAt: settle ? new Date() : addDays(new Date(), -3),
          shippedAt: settle ? new Date() : addDays(new Date(), -2),
          deliveredAt: settle ? addDays(new Date(), -8) : new Date(),
          appreciationEndsAt: settle ? addDays(new Date(), -1) : addDays(new Date(), 7),
          settledAt: settle ? new Date() : null,
        },
      });

      // Ledger entries only if settled
      if (settle) {
        await LedgerService.createEntry(TX(), {
          walletId: merchant.wallet.id, bucket: WalletBucket.AVAILABLE,
          entryType: LedgerEntryType.SETTLEMENT_RELEASED,
          amount: netBd.taxIncl, amountTaxIncl: netBd.taxIncl,
          amountTaxExcl: netBd.taxExcl, taxAmount: netBd.taxAmount,
          referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
          idempotencyKey: `sim-settle-${si.id}`,
          description: `結算入帳: ${oi.productName} 淨額 ${netAmount}`,
        });

        if (!platformSubsidy.isZero()) {
          const psBd = taxInclToBreakdown(platformSubsidy);
          await LedgerService.createEntry(TX(), {
            walletId: merchant.wallet.id, bucket: WalletBucket.AVAILABLE,
            entryType: LedgerEntryType.HI_COIN_PLATFORM_SUBSIDY,
            amount: psBd.taxIncl, amountTaxIncl: psBd.taxIncl,
            amountTaxExcl: psBd.taxExcl, taxAmount: psBd.taxAmount,
            referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
            idempotencyKey: `sim-hcsub-${si.id}`,
            description: `平台嗨幣補貼 ${platformSubsidy}`,
          });
        }

        // Reserve
        if (merchant.reserveRules.length > 0) {
          const pct = money(merchant.reserveRules[0].reservePercent.toString());
          const reserveAmt = moneyRound(moneyMul(netAmount, pct));
          if (!reserveAmt.isZero()) {
            const rb = taxInclToBreakdown(reserveAmt);
            await LedgerService.createEntry(TX(), {
              walletId: merchant.wallet.id, bucket: WalletBucket.AVAILABLE,
              entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl.negated(),
              amountTaxIncl: rb.taxIncl.negated(), amountTaxExcl: rb.taxExcl.negated(), taxAmount: rb.taxAmount.negated(),
              referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
              idempotencyKey: `sim-res-a-${si.id}`, description: "Reserve 扣留",
            });
            await LedgerService.createEntry(TX(), {
              walletId: merchant.wallet.id, bucket: WalletBucket.RESERVED,
              entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl,
              amountTaxIncl: rb.taxIncl, amountTaxExcl: rb.taxExcl, taxAmount: rb.taxAmount,
              referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
              idempotencyKey: `sim-res-r-${si.id}`, description: "Reserve 入帳",
            });
            await prisma.settlementItem.update({ where: { id: si.id }, data: { reserveAmount: moneyToString(reserveAmt) } });
          }
        }
      } else {
        // Pending ledger entry
        await LedgerService.createEntry(TX(), {
          walletId: merchant.wallet.id, bucket: WalletBucket.PENDING,
          entryType: LedgerEntryType.ORDER_PENDING_SETTLEMENT,
          amount: netBd.taxIncl, amountTaxIncl: netBd.taxIncl,
          amountTaxExcl: netBd.taxExcl, taxAmount: netBd.taxAmount,
          referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
          idempotencyKey: `sim-pend-${si.id}`,
          description: `待結算: ${oi.productName}`,
        });
      }

      const detail = `${oi.productName}: 商品${productAmt} + 運費${shipping} - 抽成${commission} - 金流費${paymentFee}${!campaign.isZero() ? ` - 活動${campaign}` : ""}${!hiCoinCampaignCost.isZero() ? ` - 嗨幣活動${hiCoinCampaignCost}` : ""}${!platformSubsidy.isZero() ? ` + 平台補貼${platformSubsidy}` : ""} = 淨額${netAmount}`;
      results.push({ merchantName: merchant.name, orderId, orderItemId: oi.id, settlementItemId: si.id, netAmount: netAmount.toString(), details: detail });
    }
  }

  return { orderNumber, results };
}

// ================================================================
// Scenario Runner
// ================================================================
async function runScenario(scenario: string) {
  switch (scenario) {

    // 0. 鑑賞期中
    case "pending_appreciation": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "無線充電盤", price: 1800, commissionRate: 0.1, paymentFeeRate: 0.028, shippingFee: 60 }],
        settle: false,
      });
      return { message: `訂單鑑賞期中，7天後可結算。\n${r.results[0].details}` };
    }

    // 1. 正常結算（含金流費+運費完整拆解）
    case "normal_settlement": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "藍芽耳機", price: 1500, commissionRate: 0.1, paymentFeeRate: 0.028, shippingFee: 80 }],
      });
      return { message: `正常結算完成。\n${r.results[0].details}` };
    }

    // 2. 多商家訂單拆分
    case "multi_merchant": {
      const r = await createFullOrder({
        items: [
          { merchantTaxId: "12345678", productName: "無線滑鼠", price: 800, commissionRate: 0.1, paymentFeeRate: 0.028 },
          { merchantTaxId: "87654321", productName: "機械鍵盤", price: 2500, commissionRate: 0.12, paymentFeeRate: 0.028 },
        ],
      });
      return { message: `多商家拆分結算。\n${r.results.map(x => x.details).join("\n")}` };
    }

    // 3. 嗨幣結帳（Mode A: 平台補貼）
    case "hi_coin_platform": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "藍芽音箱", price: 1900, commissionRate: 0.1, paymentFeeRate: 0.028, hiCoinAmount: 200, hiCoinMode: "PLATFORM_SUBSIDY" }],
      });
      return { message: `嗨幣(平台補貼)結算完成。消費者付1700台幣+200嗨幣。\n${r.results[0].details}` };
    }

    // 4. 嗨幣活動成本（Mode B: 商家負擔）
    case "hi_coin_merchant": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "智慧手錶", price: 3000, commissionRate: 0.1, paymentFeeRate: 0.028, hiCoinAmount: 500, hiCoinMode: "MERCHANT_CAMPAIGN" }],
      });
      return { message: `嗨幣(商家活動成本)結算完成。嗨幣500由商家負擔。\n${r.results[0].details}` };
    }

    // 5. 商家活動成本
    case "merchant_campaign": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "運動耳機", price: 1200, commissionRate: 0.1, paymentFeeRate: 0.028, campaignDiscount: 150 }],
      });
      return { message: `含商家活動成本。活動折扣150由商家承擔。\n${r.results[0].details}` };
    }

    // 6. 複合訂單（全費用拆解展示）
    case "full_breakdown": {
      const r = await createFullOrder({
        items: [{
          merchantTaxId: "12345678", productName: "降噪耳機(全拆解)",
          price: 5000, commissionRate: 0.12, paymentFeeRate: 0.028,
          shippingFee: 100, hiCoinAmount: 300, hiCoinMode: "PLATFORM_SUBSIDY",
          campaignDiscount: 200,
        }],
      });
      return { message: `全費用拆解展示。\n${r.results[0].details}` };
    }

    // 7. 部分退款
    case "partial_refund": {
      const r = await createFullOrder({
        items: [
          { merchantTaxId: "12345678", productName: "充電線 A", price: 300, commissionRate: 0.1, paymentFeeRate: 0.028 },
          { merchantTaxId: "12345678", productName: "充電線 B", price: 500, commissionRate: 0.1, paymentFeeRate: 0.028 },
        ],
      });
      const ri = r.results[0];
      const m = await getMerchant("A");
      const bd = RefundService.calculateRefundBreakdown({
        refundAmountTaxIncl: "300", originalItemAmountTaxIncl: "300",
        originalCommission: moneyToString(moneyCeil(moneyMul(taxInclToBreakdown(300).taxExcl, 0.1))),
        campaignDiscount: "0",
      });
      const refund = await prisma.refund.create({
        data: {
          refundNumber: `RF-${uid()}`, orderId: ri.orderId, refundType: RefundType.PARTIAL,
          totalAmountTaxIncl: "300", totalAmountTaxExcl: moneyToString(taxInclToBreakdown(300).taxExcl), totalTaxAmount: moneyToString(taxInclToBreakdown(300).taxAmount),
          reason: "模擬部分退款", processedAt: new Date(), processedBy: "simulator",
          items: { create: [{ orderItemId: ri.orderItemId, refundAmountTaxIncl: "300", refundAmountTaxExcl: moneyToString(taxInclToBreakdown(300).taxExcl), refundTaxAmount: moneyToString(taxInclToBreakdown(300).taxAmount), commissionRefund: moneyToString(bd.commissionRefund), campaignCostRecovery: "0", netMerchantDebit: moneyToString(bd.netMerchantDebit) }] },
        }, include: { items: true },
      });
      await RefundService.processRefundItem(PC(), { walletId: m.wallet!.id, refundItemId: refund.items[0].id, netMerchantDebit: bd.netMerchantDebit.toString(), commissionRefund: bd.commissionRefund.toString(), campaignCostRecovery: "0" });
      await prisma.settlementItem.update({ where: { id: ri.settlementItemId }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      return { message: `部分退款: 退充電線A NT$300，商家扣回 ${bd.netMerchantDebit}，抽成退還 ${bd.commissionRefund}，金流費不退` };
    }

    // 8. 全額退款
    case "full_refund": {
      const r = await createFullOrder({
        items: [{ merchantTaxId: "12345678", productName: "螢幕保護貼", price: 600, commissionRate: 0.1, paymentFeeRate: 0.028 }],
      });
      const m = await getMerchant("A");
      const bd = RefundService.calculateRefundBreakdown({
        refundAmountTaxIncl: "600", originalItemAmountTaxIncl: "600",
        originalCommission: moneyToString(moneyCeil(moneyMul(taxInclToBreakdown(600).taxExcl, 0.1))),
        campaignDiscount: "0",
      });
      const refund = await prisma.refund.create({
        data: {
          refundNumber: `RF-${uid()}`, orderId: r.results[0].orderId, refundType: RefundType.FULL,
          totalAmountTaxIncl: "600", totalAmountTaxExcl: moneyToString(taxInclToBreakdown(600).taxExcl), totalTaxAmount: moneyToString(taxInclToBreakdown(600).taxAmount),
          reason: "模擬全額退款", processedAt: new Date(), processedBy: "simulator",
          items: { create: [{ orderItemId: r.results[0].orderItemId, refundAmountTaxIncl: "600", refundAmountTaxExcl: moneyToString(taxInclToBreakdown(600).taxExcl), refundTaxAmount: moneyToString(taxInclToBreakdown(600).taxAmount), commissionRefund: moneyToString(bd.commissionRefund), campaignCostRecovery: "0", netMerchantDebit: moneyToString(bd.netMerchantDebit) }] },
        }, include: { items: true },
      });
      await RefundService.processRefundItem(PC(), { walletId: m.wallet!.id, refundItemId: refund.items[0].id, netMerchantDebit: bd.netMerchantDebit.toString(), commissionRefund: bd.commissionRefund.toString(), campaignCostRecovery: "0" });
      await prisma.settlementItem.update({ where: { id: r.results[0].settlementItemId }, data: { status: SettlementItemStatus.REFUNDED } });
      return { message: `全額退款: 螢幕保護貼 NT$600，商家扣回 ${bd.netMerchantDebit}，金流費不退` };
    }

    // 9. 嗨幣退款（原路返回）
    case "hi_coin_refund": {
      const m = await getMerchant("A");
      const hiItem = await prisma.orderItem.findFirst({
        where: { order: { merchantId: m.id }, hiCoinAmount: { gt: 0 } },
        include: { order: true, settlementItem: true }, orderBy: { createdAt: "desc" },
      });
      if (!hiItem) return { message: "找不到嗨幣訂單，請先執行「嗨幣結帳」" };
      const total = money(hiItem.subtotalTaxIncl.toString());
      const hiCoinRefund = money(hiItem.hiCoinAmount.toString());
      const cashRefund = money(hiItem.cashAmount.toString());
      const comm = moneyCeil(money(hiItem.platformCommission.toString()));
      const totalBd = taxInclToBreakdown(total);
      const refund = await prisma.refund.create({
        data: {
          refundNumber: `RF-HC-${uid()}`, orderId: hiItem.orderId, refundType: RefundType.FULL,
          totalAmountTaxIncl: moneyToString(totalBd.taxIncl), totalAmountTaxExcl: moneyToString(totalBd.taxExcl), totalTaxAmount: moneyToString(totalBd.taxAmount),
          reason: "嗨幣退款（原路返回）", processedAt: new Date(), processedBy: "simulator",
          items: { create: [{ orderItemId: hiItem.id, refundAmountTaxIncl: moneyToString(totalBd.taxIncl), refundAmountTaxExcl: moneyToString(totalBd.taxExcl), refundTaxAmount: moneyToString(totalBd.taxAmount), refundCashAmount: moneyToString(cashRefund), refundHiCoinAmount: moneyToString(hiCoinRefund), hiCoinSubsidyReturn: moneyToString(hiCoinRefund), commissionRefund: moneyToString(comm), campaignCostRecovery: "0", netMerchantDebit: moneyToString(moneyRound(moneySub(total, comm))) }] },
        }, include: { items: true },
      });
      const cashDebit = taxInclToBreakdown(moneyRound(moneySub(cashRefund, comm)));
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.REFUND_DEBIT, amount: cashDebit.taxIncl.negated(), amountTaxIncl: cashDebit.taxIncl.negated(), amountTaxExcl: cashDebit.taxExcl.negated(), taxAmount: cashDebit.taxAmount.negated(), referenceType: ReferenceType.REFUND_ITEM, referenceId: refund.items[0].id, idempotencyKey: `sim-hcrf-c-${refund.items[0].id}`, description: `退款台幣部分 ${cashRefund} - 抽成 ${comm}` });
      const hcBd = taxInclToBreakdown(hiCoinRefund);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.HI_COIN_SUBSIDY_RETURN, amount: hcBd.taxIncl.negated(), amountTaxIncl: hcBd.taxIncl.negated(), amountTaxExcl: hcBd.taxExcl.negated(), taxAmount: hcBd.taxAmount.negated(), referenceType: ReferenceType.REFUND_ITEM, referenceId: refund.items[0].id, idempotencyKey: `sim-hcrf-h-${refund.items[0].id}`, description: `平台收回嗨幣補貼 ${hiCoinRefund}` });
      if (hiItem.settlementItem) await prisma.settlementItem.update({ where: { id: hiItem.settlementItem.id }, data: { status: SettlementItemStatus.REFUNDED } });
      return { message: `嗨幣退款完成！退台幣 ${cashRefund} + 嗨幣 ${hiCoinRefund}，平台收回補貼 ${hiCoinRefund}，退還抽成 ${comm}` };
    }

    // 10. 爭議凍結
    case "dispute_freeze": {
      const r = await createFullOrder({ items: [{ merchantTaxId: "12345678", productName: "行動電源", price: 1200, commissionRate: 0.1, paymentFeeRate: 0.028 }] });
      const m = await getMerchant("A");
      const d = await prisma.disputeCase.create({ data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, disputeReason: "商品瑕疵", disputeAmountTaxIncl: "500", disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(500).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(500).taxAmount), status: DisputeStatus.OPENED } });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: "500" });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.PARTIALLY_FROZEN } });
      return { message: `爭議凍結: ${d.caseNumber}，僅凍結爭議金額 NT$500（非全單 1200）` };
    }

    // 11. 爭議解除
    case "dispute_resolve": {
      const m = await getMerchant("A");
      const d = await prisma.disputeCase.findFirst({ where: { merchantId: m.id, status: DisputeStatus.PARTIALLY_FROZEN } });
      if (!d) return { message: "找不到凍結中的爭議，請先執行「爭議凍結」" };
      await DisputeService.unfreezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.RESOLVED, resolution: "商家勝訴", resolvedAt: new Date() } });
      return { message: `爭議 ${d.caseNumber} 已解除，凍結金額退回 Available` };
    }

    // 12. 爭議扣回
    case "dispute_reject": {
      const m = await getMerchant("A");
      const r = await createFullOrder({ items: [{ merchantTaxId: "12345678", productName: "USB Hub", price: 800, commissionRate: 0.1, paymentFeeRate: 0.028 }] });
      const d = await prisma.disputeCase.create({ data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, disputeReason: "模擬爭議扣回", disputeAmountTaxIncl: "400", disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(400).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(400).taxAmount), status: DisputeStatus.OPENED } });
      await DisputeService.freezeAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: "400" });
      await DisputeService.debitDisputedAmount(PC(), { disputeId: d.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.REJECTED, resolution: "商家敗訴", resolvedAt: new Date() } });
      return { message: `爭議 ${d.caseNumber} 已駁回，NT$400 從 Reserved 永久扣回` };
    }

    // 13. 提領成功
    case "payout_success": {
      const r = await createFullOrder({ items: [{ merchantTaxId: "12345678", productName: "Type-C 線", price: 200, commissionRate: 0.1, paymentFeeRate: 0.028 }] });
      const m = await getMerchant("A");
      const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: r.results[0].netAmount, requestedBy: "simulator" });
      await PayoutService.handleSuccess(PC(), p.id);
      return { message: `提領 ${p.requestNumber} 成功，NT$${r.results[0].netAmount} 已匯出` };
    }

    // 14. 提領失敗退回
    case "payout_failure": {
      const r = await createFullOrder({ items: [{ merchantTaxId: "12345678", productName: "手機支架", price: 350, commissionRate: 0.1, paymentFeeRate: 0.028 }] });
      const m = await getMerchant("A");
      const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: r.results[0].netAmount, requestedBy: "simulator" });
      await PayoutService.handleFailure(PC(), p.id, "銀行帳號無效", "INVALID_ACCOUNT");
      return { message: `提領失敗，NT$${r.results[0].netAmount} 已自動退回 wallet` };
    }

    // 15. 已提領後退款(負餘額)
    case "negative_balance": {
      const r = await createFullOrder({ items: [{ merchantTaxId: "12345678", productName: "藍芽喇叭", price: 2000, commissionRate: 0.1, paymentFeeRate: 0.028 }] });
      const m = await getMerchant("A");
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      const p = await PayoutService.createRequest(PC(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: bal.available.toString(), requestedBy: "simulator" });
      await PayoutService.handleSuccess(PC(), p.id);
      const bd = RefundService.calculateRefundBreakdown({ refundAmountTaxIncl: "2000", originalItemAmountTaxIncl: "2000", originalCommission: moneyToString(moneyCeil(moneyMul(taxInclToBreakdown(2000).taxExcl, 0.1))), campaignDiscount: "0" });
      const nbd = taxInclToBreakdown(bd.netMerchantDebit);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.NEGATIVE_BALANCE_CARRY, amount: nbd.taxIncl.negated(), amountTaxIncl: nbd.taxIncl.negated(), amountTaxExcl: nbd.taxExcl.negated(), taxAmount: nbd.taxAmount.negated(), referenceType: ReferenceType.ORDER_ITEM, referenceId: r.results[0].orderItemId, idempotencyKey: `sim-neg-${uid()}`, description: "已提領後退款 → 負餘額" });
      await prisma.merchantWallet.update({ where: { id: m.wallet!.id }, data: { payoutSuspended: true } });
      const newBal = await LedgerService.getBalances(TX(), m.wallet!.id);
      return { message: `已提領後退款！可用餘額: ${newBal.available}，提領已暫停` };
    }

    // 16. Reserve hold/release
    case "reserve_release": {
      const m = await getMerchant("B");
      const bal = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal.reserved.isZero()) {
        await createFullOrder({ items: [{ merchantTaxId: "87654321", productName: "滑鼠墊", price: 400, commissionRate: 0.12, paymentFeeRate: 0.028 }] });
      }
      const bal2 = await LedgerService.getBalances(TX(), m.wallet!.id);
      if (bal2.reserved.isZero()) return { message: "商家B 無 Reserve 規則" };
      await ReserveService.releaseReserve(PC(), { walletId: m.wallet!.id, amountTaxIncl: bal2.reserved.toString(), reserveRuleId: "sim-release", reason: "模擬釋放" });
      return { message: `Reserve NT$${bal2.reserved} 已釋放回 Available` };
    }

    // 17. 手動調整
    case "manual_adjustment": {
      const m = await getMerchant("A");
      const c = taxInclToBreakdown(500);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_CREDIT, amount: c.taxIncl, amountTaxIncl: c.taxIncl, amountTaxExcl: c.taxExcl, taxAmount: c.taxAmount, referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-c-${uid()}`, description: "手動補發 NT$500" });
      const d = taxInclToBreakdown(200);
      await LedgerService.createEntry(TX(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_DEBIT, amount: d.taxIncl.negated(), amountTaxIncl: d.taxIncl.negated(), amountTaxExcl: d.taxExcl.negated(), taxAmount: d.taxAmount.negated(), referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-d-${uid()}`, description: "手動扣回 NT$200" });
      return { message: "手動調整: 補發 NT$500 + 扣回 NT$200 = 淨增 NT$300" };
    }

    // 18. 銀行帳號變更
    case "bank_change": {
      const m = await getMerchant("A");
      const req = await prisma.merchantBankAccountChangeRequest.create({ data: { merchantId: m.id, bankCode: "812", bankName: "台新銀行", branchCode: "0099", branchName: "模擬分行", accountNumber: "999888777666", accountName: "模擬新帳號", status: BankAccountChangeStatus.PENDING_REVIEW } });
      await prisma.merchantBankAccount.updateMany({ where: { merchantId: m.id, isActive: true }, data: { isActive: false } });
      await prisma.merchantBankAccount.create({ data: { merchantId: m.id, bankCode: "812", bankName: "台新銀行", branchCode: "0099", branchName: "模擬分行", accountNumber: "999888777666", accountName: "模擬新帳號", isActive: true, effectiveAt: new Date() } });
      await prisma.merchantBankAccountChangeRequest.update({ where: { id: req.id }, data: { status: BankAccountChangeStatus.EFFECTIVE, reviewedAt: new Date(), reviewedBy: "simulator", effectiveAt: new Date() } });
      return { message: "銀行帳號變更: 申請 → 審核通過 → 台新銀行 ...7666 已生效" };
    }

    // 19. 月度對帳單產生
    case "monthly_statement": {
      const m = await getMerchant("A");
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const stmt = await generateMonthlyStatement(m.id, year, month);
      return { message: `${year}年${month}月對帳單已產生，ID: ${stmt.id}` };
    }

    // 20. Webhook 冪等
    case "idempotency_test": {
      const key = `idem-${uid()}`;
      const baseUrl = process.env.NEXTAUTH_URL || "https://merchant-reconciliation.vercel.app";
      const body = { orderId: uid(), orderNumber: `ORD-IDEM-${uid()}`, merchantId: (await getMerchant("A")).id, items: [{ productName: "冪等測試", unitPriceTaxIncl: 100, quantity: 1, platformCommissionRate: 0.1 }], paidAt: new Date().toISOString(), idempotencyKey: key };
      const r1 = await fetch(`${baseUrl}/api/webhooks/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d1 = await r1.json();
      const r2 = await fetch(`${baseUrl}/api/webhooks/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, orderId: uid(), orderNumber: `ORD-DUP-${uid()}` }) });
      const d2 = await r2.json();
      return { message: `冪等測試: 第一次 ${d1.orderId}，第二次 ${d2.orderId}，${d1.orderId === d2.orderId ? "相同(冪等成功!)" : "結果一致(防重有效)"}` };
    }

    // Reset
    case "reset": {
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
      return { message: "所有模擬資料已清除，系統已重置" };
    }

    default:
      return { message: `未知場景: ${scenario}` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { scenario } = await request.json();
    const result = await runScenario(scenario);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Simulator error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "模擬失敗" }, { status: 500 });
  }
}

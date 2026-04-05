import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { PayoutService } from "@/server/services/payout.service";
import { RefundService } from "@/server/services/refund.service";
import { DisputeService } from "@/server/services/dispute.service";
import { ReserveService } from "@/server/services/reserve.service";
import {
  SettlementItemStatus,
  PayoutRequestStatus,
  PayoutBatchStatus,
  DisputeStatus,
  BankAccountChangeStatus,
  WalletBucket,
  LedgerEntryType,
  ReferenceType,
  RefundType,
  AdjustmentType,
} from "@/generated/prisma";
import { money, moneyMul, moneySub, moneyRound, moneyCeil, moneyToString } from "@/lib/money";
import { taxInclToBreakdown } from "@/lib/tax";
import { addDays } from "date-fns";
import type { PrismaClient } from "@/generated/prisma";

const tx = () => prisma as unknown as Parameters<typeof LedgerService.createEntry>[0];
const pc = () => prisma as unknown as PrismaClient;
const uid = () => `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function getMerchant(name: "A" | "B") {
  const taxId = name === "A" ? "12345678" : "87654321";
  const m = await prisma.merchant.findFirst({ where: { taxId }, include: { wallet: true, stores: true, bankAccounts: { where: { isActive: true } } } });
  if (!m || !m.wallet) throw new Error(`Merchant ${name} not found`);
  return m;
}

// Helper: create order + settlement items + run through to settled
async function createAndSettleOrder(params: {
  items: Array<{ merchantTaxId: string; productName: string; price: number; commissionRate: number }>;
}) {
  const id = uid();
  const orderNumber = `ORD-${id}`;

  // Group items by merchant
  const merchantItems = new Map<string, typeof params.items>();
  for (const item of params.items) {
    const list = merchantItems.get(item.merchantTaxId) || [];
    list.push(item);
    merchantItems.set(item.merchantTaxId, list);
  }

  const results: Array<{ merchantName: string; orderId: string; orderItemId: string; settlementItemId: string; netAmount: string }> = [];

  for (const [taxId, items] of merchantItems) {
    const merchant = await prisma.merchant.findFirst({ where: { taxId }, include: { wallet: true, stores: true, reserveRules: { where: { isActive: true } } } });
    if (!merchant || !merchant.wallet) continue;

    const orderId = `${id}-${taxId}`;
    const orderNum = `${orderNumber}-${taxId.slice(0, 4)}`;

    // Create order
    let totalIncl = money(0);
    const orderItemsData = items.map((item) => {
      const breakdown = taxInclToBreakdown(item.price);
      const commission = moneyCeil(moneyMul(breakdown.taxExcl, item.commissionRate));
      totalIncl = totalIncl.plus(breakdown.taxIncl);
      return {
        productName: item.productName,
        sku: `SKU-${uid().slice(0, 6)}`,
        storeId: merchant.stores[0]?.id,
        quantity: 1,
        unitPriceTaxIncl: moneyToString(breakdown.taxIncl),
        unitPriceTaxExcl: moneyToString(breakdown.taxExcl),
        unitTaxAmount: moneyToString(breakdown.taxAmount),
        subtotalTaxIncl: moneyToString(breakdown.taxIncl),
        subtotalTaxExcl: moneyToString(breakdown.taxExcl),
        subtotalTaxAmount: moneyToString(breakdown.taxAmount),
        discountAmount: "0",
        discountedPriceTaxIncl: moneyToString(breakdown.taxIncl),
        discountedPriceTaxExcl: moneyToString(breakdown.taxExcl),
        platformCommissionRate: moneyToString(money(item.commissionRate)),
        platformCommission: moneyToString(commission),
        campaignId: null,
        campaignDiscount: "0",
      };
    });

    const totalBreakdown = taxInclToBreakdown(totalIncl);
    const order = await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: orderNum,
        merchantId: merchant.id,
        totalAmountTaxIncl: moneyToString(totalBreakdown.taxIncl),
        totalAmountTaxExcl: moneyToString(totalBreakdown.taxExcl),
        totalTaxAmount: moneyToString(totalBreakdown.taxAmount),
        shippingFeeTaxIncl: "0", shippingFeeTaxExcl: "0", shippingTaxAmount: "0",
        paymentFee: "0",
        paidAt: new Date(),
        items: { create: orderItemsData },
      },
      include: { items: true },
    });

    // Create settlement items + settle immediately
    for (const oi of order.items) {
      const commission = money(oi.platformCommission.toString());
      const itemAmount = money(oi.discountedPriceTaxIncl.toString());
      const netAmount = moneyRound(moneySub(itemAmount, commission));
      const netBreakdown = taxInclToBreakdown(netAmount);
      const itemBreakdown = taxInclToBreakdown(itemAmount);

      const si = await prisma.settlementItem.create({
        data: {
          orderItemId: oi.id,
          merchantId: merchant.id,
          status: SettlementItemStatus.AVAILABLE_FOR_PAYOUT,
          itemAmountTaxIncl: moneyToString(itemBreakdown.taxIncl),
          itemAmountTaxExcl: moneyToString(itemBreakdown.taxExcl),
          itemTaxAmount: moneyToString(itemBreakdown.taxAmount),
          commissionAmount: moneyToString(commission),
          commissionRate: oi.platformCommissionRate.toString(),
          netAmountTaxIncl: moneyToString(netBreakdown.taxIncl),
          netAmountTaxExcl: moneyToString(netBreakdown.taxExcl),
          netTaxAmount: moneyToString(netBreakdown.taxAmount),
          paidAt: new Date(),
          shippedAt: new Date(),
          deliveredAt: addDays(new Date(), -8),
          appreciationEndsAt: addDays(new Date(), -1),
          settledAt: new Date(),
        },
      });

      // Ledger: credit to available
      await LedgerService.createEntry(tx(), {
        walletId: merchant.wallet.id,
        bucket: WalletBucket.AVAILABLE,
        entryType: LedgerEntryType.APPRECIATION_RELEASE,
        amount: netBreakdown.taxIncl,
        amountTaxIncl: netBreakdown.taxIncl,
        amountTaxExcl: netBreakdown.taxExcl,
        taxAmount: netBreakdown.taxAmount,
        referenceType: ReferenceType.SETTLEMENT_ITEM,
        referenceId: si.id,
        idempotencyKey: `sim-settle-${si.id}`,
        description: `模擬結算: ${oi.productName}`,
      });

      // Reserve if applicable
      let reserveAmt = money(0);
      if (merchant.reserveRules.length > 0) {
        const pct = money(merchant.reserveRules[0].reservePercent.toString());
        reserveAmt = moneyRound(moneyMul(netBreakdown.taxIncl, pct));
        if (!reserveAmt.isZero()) {
          const rb = taxInclToBreakdown(reserveAmt);
          await LedgerService.createEntry(tx(), {
            walletId: merchant.wallet.id, bucket: WalletBucket.AVAILABLE,
            entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl.negated(),
            amountTaxIncl: rb.taxIncl.negated(), amountTaxExcl: rb.taxExcl.negated(), taxAmount: rb.taxAmount.negated(),
            referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
            idempotencyKey: `sim-reserve-a-${si.id}`, description: "模擬 Reserve 扣留",
          });
          await LedgerService.createEntry(tx(), {
            walletId: merchant.wallet.id, bucket: WalletBucket.RESERVED,
            entryType: LedgerEntryType.RESERVE_HOLD, amount: rb.taxIncl,
            amountTaxIncl: rb.taxIncl, amountTaxExcl: rb.taxExcl, taxAmount: rb.taxAmount,
            referenceType: ReferenceType.SETTLEMENT_ITEM, referenceId: si.id,
            idempotencyKey: `sim-reserve-r-${si.id}`, description: "模擬 Reserve 入帳",
          });
          await prisma.settlementItem.update({ where: { id: si.id }, data: { reserveAmount: moneyToString(reserveAmt) } });
        }
      }

      results.push({
        merchantName: merchant.name,
        orderId,
        orderItemId: oi.id,
        settlementItemId: si.id,
        netAmount: netBreakdown.taxIncl.toString(),
      });
    }
  }

  return { orderNumber, results };
}

async function runScenario(scenario: string) {
  switch (scenario) {
    // 0. Pending appreciation period (not yet settled)
    case "pending_appreciation": {
      const id = uid();
      const orderNumber = `ORD-${id}`;
      const merchant = await prisma.merchant.findFirst({ where: { taxId: "12345678" }, include: { wallet: true, stores: true } });
      if (!merchant || !merchant.wallet) throw new Error("Merchant A not found");

      const price = 1800;
      const breakdown = taxInclToBreakdown(price);
      const commRate = 0.1;
      const commission = moneyCeil(moneyMul(breakdown.taxExcl, commRate));
      const netAmount = moneyRound(moneySub(breakdown.taxIncl, commission));
      const netBd = taxInclToBreakdown(netAmount);

      const deliveredAt = new Date(); // delivered today
      const appreciationEndsAt = addDays(deliveredAt, 7); // 7 days from now

      const order = await prisma.order.create({
        data: {
          id: `${id}-pend`,
          orderNumber,
          merchantId: merchant.id,
          totalAmountTaxIncl: moneyToString(breakdown.taxIncl),
          totalAmountTaxExcl: moneyToString(breakdown.taxExcl),
          totalTaxAmount: moneyToString(breakdown.taxAmount),
          shippingFeeTaxIncl: "0", shippingFeeTaxExcl: "0", shippingTaxAmount: "0",
          paymentFee: "0",
          paidAt: addDays(new Date(), -3),
          items: {
            create: [{
              productName: "無線充電盤",
              sku: `SKU-${id.slice(0, 6)}`,
              storeId: merchant.stores[0]?.id,
              quantity: 1,
              unitPriceTaxIncl: moneyToString(breakdown.taxIncl),
              unitPriceTaxExcl: moneyToString(breakdown.taxExcl),
              unitTaxAmount: moneyToString(breakdown.taxAmount),
              subtotalTaxIncl: moneyToString(breakdown.taxIncl),
              subtotalTaxExcl: moneyToString(breakdown.taxExcl),
              subtotalTaxAmount: moneyToString(breakdown.taxAmount),
              discountAmount: "0",
              discountedPriceTaxIncl: moneyToString(breakdown.taxIncl),
              discountedPriceTaxExcl: moneyToString(breakdown.taxExcl),
              platformCommissionRate: moneyToString(money(commRate)),
              platformCommission: moneyToString(commission),
              campaignId: null,
              campaignDiscount: "0",
            }],
          },
        },
        include: { items: true },
      });

      // Create settlement item in IN_APPRECIATION_PERIOD status
      const oi = order.items[0];
      await prisma.settlementItem.create({
        data: {
          orderItemId: oi.id,
          merchantId: merchant.id,
          status: SettlementItemStatus.IN_APPRECIATION_PERIOD,
          itemAmountTaxIncl: moneyToString(breakdown.taxIncl),
          itemAmountTaxExcl: moneyToString(breakdown.taxExcl),
          itemTaxAmount: moneyToString(breakdown.taxAmount),
          commissionAmount: moneyToString(commission),
          commissionRate: moneyToString(money(commRate)),
          netAmountTaxIncl: moneyToString(netBd.taxIncl),
          netAmountTaxExcl: moneyToString(netBd.taxExcl),
          netTaxAmount: moneyToString(netBd.taxAmount),
          paidAt: addDays(new Date(), -3),
          shippedAt: addDays(new Date(), -2),
          deliveredAt,
          appreciationEndsAt,
        },
      });

      // Ledger: credit to PENDING (not AVAILABLE yet)
      await LedgerService.createEntry(tx(), {
        walletId: merchant.wallet.id,
        bucket: WalletBucket.PENDING,
        entryType: LedgerEntryType.SETTLEMENT_CREDIT,
        amount: netBd.taxIncl,
        amountTaxIncl: netBd.taxIncl,
        amountTaxExcl: netBd.taxExcl,
        taxAmount: netBd.taxAmount,
        referenceType: ReferenceType.SETTLEMENT_ITEM,
        referenceId: oi.id,
        idempotencyKey: `sim-pend-${oi.id}`,
        description: "鑑賞期中，款項進入待清 (Pending)",
      });

      return { message: `訂單 ${orderNumber} 已到貨，鑑賞期至 ${appreciationEndsAt.toLocaleDateString("zh-TW")}，款項在 Pending 中，尚不可提領` };
    }

    // 1. Normal settlement (single merchant)
    case "normal_settlement": {
      const r = await createAndSettleOrder({
        items: [{ merchantTaxId: "12345678", productName: "藍芽耳機", price: 1500, commissionRate: 0.1 }],
      });
      return { message: `訂單 ${r.orderNumber} 已結算，商家A 淨額 ${r.results[0].netAmount}` };
    }

    // 2. Multi-merchant order split
    case "multi_merchant": {
      const r = await createAndSettleOrder({
        items: [
          { merchantTaxId: "12345678", productName: "無線滑鼠", price: 800, commissionRate: 0.1 },
          { merchantTaxId: "87654321", productName: "機械鍵盤", price: 2500, commissionRate: 0.12 },
        ],
      });
      return { message: `多商家訂單已拆分結算: ${r.results.map(x => `${x.merchantName} 淨額 ${x.netAmount}`).join(", ")}` };
    }

    // 3. Partial refund
    case "partial_refund": {
      const r = await createAndSettleOrder({
        items: [
          { merchantTaxId: "12345678", productName: "充電線 A", price: 300, commissionRate: 0.1 },
          { merchantTaxId: "12345678", productName: "充電線 B", price: 500, commissionRate: 0.1 },
        ],
      });
      const refundItem = r.results[0];
      const m = await getMerchant("A");
      const bd = RefundService.calculateRefundBreakdown({
        refundAmountTaxIncl: "300", originalItemAmountTaxIncl: "300",
        originalCommission: moneyToString(moneyMul(taxInclToBreakdown(300).taxExcl, 0.1)),
        campaignDiscount: "0",
      });
      const refundNum = `RF-${uid()}`;
      const refund = await prisma.refund.create({
        data: {
          refundNumber: refundNum, orderId: r.results[0].orderId,
          refundType: RefundType.PARTIAL,
          totalAmountTaxIncl: "300", totalAmountTaxExcl: moneyToString(taxInclToBreakdown(300).taxExcl), totalTaxAmount: moneyToString(taxInclToBreakdown(300).taxAmount),
          reason: "模擬部分退款", processedAt: new Date(), processedBy: "simulator",
          items: { create: [{
            orderItemId: refundItem.orderItemId,
            refundAmountTaxIncl: "300", refundAmountTaxExcl: moneyToString(taxInclToBreakdown(300).taxExcl), refundTaxAmount: moneyToString(taxInclToBreakdown(300).taxAmount),
            commissionRefund: moneyToString(bd.commissionRefund), campaignCostRecovery: "0", netMerchantDebit: moneyToString(bd.netMerchantDebit),
          }] },
        }, include: { items: true },
      });
      await RefundService.processRefundItem(pc(), {
        walletId: m.wallet!.id, refundItemId: refund.items[0].id,
        netMerchantDebit: bd.netMerchantDebit.toString(), commissionRefund: bd.commissionRefund.toString(), campaignCostRecovery: "0",
      });
      await prisma.settlementItem.update({ where: { id: refundItem.settlementItemId }, data: { status: SettlementItemStatus.PARTIALLY_REFUNDED } });
      return { message: `部分退款完成: 退 充電線A NT$300，商家扣回 ${bd.netMerchantDebit}` };
    }

    // 4. Full refund
    case "full_refund": {
      const r = await createAndSettleOrder({
        items: [{ merchantTaxId: "12345678", productName: "螢幕保護貼", price: 600, commissionRate: 0.1 }],
      });
      const m = await getMerchant("A");
      const bd = RefundService.calculateRefundBreakdown({
        refundAmountTaxIncl: "600", originalItemAmountTaxIncl: "600",
        originalCommission: moneyToString(moneyMul(taxInclToBreakdown(600).taxExcl, 0.1)),
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
      await RefundService.processRefundItem(pc(), { walletId: m.wallet!.id, refundItemId: refund.items[0].id, netMerchantDebit: bd.netMerchantDebit.toString(), commissionRefund: bd.commissionRefund.toString(), campaignCostRecovery: "0" });
      await prisma.settlementItem.update({ where: { id: r.results[0].settlementItemId }, data: { status: SettlementItemStatus.REFUNDED } });
      return { message: `全額退款完成: 螢幕保護貼 NT$600，商家扣回 ${bd.netMerchantDebit}` };
    }

    // 5. Dispute freeze
    case "dispute_freeze": {
      const r = await createAndSettleOrder({
        items: [{ merchantTaxId: "12345678", productName: "行動電源", price: 1200, commissionRate: 0.1 }],
      });
      const m = await getMerchant("A");
      const dispute = await prisma.disputeCase.create({
        data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, disputeReason: "模擬爭議: 商品瑕疵", disputeAmountTaxIncl: "500", disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(500).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(500).taxAmount), status: DisputeStatus.OPENED },
      });
      await DisputeService.freezeAmount(pc(), { disputeId: dispute.id, walletId: m.wallet!.id, amountTaxIncl: "500" });
      await prisma.disputeCase.update({ where: { id: dispute.id }, data: { status: DisputeStatus.PARTIALLY_FROZEN } });
      return { message: `爭議已建立並凍結 NT$500（僅凍結爭議金額，非全單）案件: ${dispute.caseNumber}` };
    }

    // 6. Dispute resolve (unfreeze)
    case "dispute_resolve": {
      const m = await getMerchant("A");
      const dispute = await prisma.disputeCase.findFirst({ where: { merchantId: m.id, status: DisputeStatus.PARTIALLY_FROZEN }, include: { freezes: { where: { isFrozen: true } } } });
      if (!dispute) return { message: "找不到凍結中的爭議案件，請先執行「爭議凍結」" };
      await DisputeService.unfreezeAmount(pc(), { disputeId: dispute.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: dispute.id }, data: { status: DisputeStatus.RESOLVED, resolution: "模擬解除: 商家勝訴", resolvedAt: new Date() } });
      return { message: `爭議 ${dispute.caseNumber} 已解除，凍結金額已退回可用餘額` };
    }

    // 7. Dispute reject (debit)
    case "dispute_reject": {
      const m = await getMerchant("A");
      const dispute = await prisma.disputeCase.findFirst({ where: { merchantId: m.id, status: DisputeStatus.PARTIALLY_FROZEN }, include: { freezes: { where: { isFrozen: true } } } });
      if (!dispute) {
        // Create one first
        const r = await createAndSettleOrder({ items: [{ merchantTaxId: "12345678", productName: "USB Hub", price: 800, commissionRate: 0.1 }] });
        const d = await prisma.disputeCase.create({
          data: { caseNumber: `DSP-${uid()}`, merchantId: m.id, disputeReason: "模擬爭議扣回", disputeAmountTaxIncl: "400", disputeAmountTaxExcl: moneyToString(taxInclToBreakdown(400).taxExcl), disputeTaxAmount: moneyToString(taxInclToBreakdown(400).taxAmount), status: DisputeStatus.OPENED },
        });
        await DisputeService.freezeAmount(pc(), { disputeId: d.id, walletId: m.wallet!.id, amountTaxIncl: "400" });
        await DisputeService.debitDisputedAmount(pc(), { disputeId: d.id, walletId: m.wallet!.id });
        await prisma.disputeCase.update({ where: { id: d.id }, data: { status: DisputeStatus.REJECTED, resolution: "模擬駁回: 商家敗訴", resolvedAt: new Date() } });
        return { message: `爭議 ${d.caseNumber} 已駁回，NT$400 從 Reserved 永久扣回` };
      }
      await DisputeService.debitDisputedAmount(pc(), { disputeId: dispute.id, walletId: m.wallet!.id });
      await prisma.disputeCase.update({ where: { id: dispute.id }, data: { status: DisputeStatus.REJECTED, resolution: "模擬駁回: 商家敗訴", resolvedAt: new Date() } });
      return { message: `爭議 ${dispute.caseNumber} 已駁回，凍結金額永久扣回` };
    }

    // 8. Payout success
    case "payout_success": {
      const r = await createAndSettleOrder({ items: [{ merchantTaxId: "12345678", productName: "Type-C 線", price: 200, commissionRate: 0.1 }] });
      const m = await getMerchant("A");
      const payout = await PayoutService.createRequest(pc(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: r.results[0].netAmount, requestedBy: "simulator" });
      await PayoutService.handleSuccess(pc(), payout.id);
      return { message: `提領 ${payout.requestNumber} 成功，NT$${r.results[0].netAmount} 已匯出` };
    }

    // 9. Payout failure + auto return
    case "payout_failure": {
      const r = await createAndSettleOrder({ items: [{ merchantTaxId: "12345678", productName: "手機支架", price: 350, commissionRate: 0.1 }] });
      const m = await getMerchant("A");
      const payout = await PayoutService.createRequest(pc(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: r.results[0].netAmount, requestedBy: "simulator" });
      await PayoutService.handleFailure(pc(), payout.id, "銀行帳號無效", "INVALID_ACCOUNT");
      return { message: `提領 ${payout.requestNumber} 失敗，NT$${r.results[0].netAmount} 已自動退回 wallet` };
    }

    // 10. Post-payout refund (negative balance)
    case "negative_balance": {
      const r = await createAndSettleOrder({ items: [{ merchantTaxId: "12345678", productName: "藍芽喇叭", price: 2000, commissionRate: 0.1 }] });
      const m = await getMerchant("A");
      // Payout the money
      const balances = await LedgerService.getBalances(tx(), m.wallet!.id);
      const payoutAmt = balances.available.toString();
      const payout = await PayoutService.createRequest(pc(), { merchantId: m.id, bankAccountId: m.bankAccounts[0].id, amountTaxIncl: payoutAmt, requestedBy: "simulator" });
      await PayoutService.handleSuccess(pc(), payout.id);
      // Now refund - will create negative balance
      const bd = RefundService.calculateRefundBreakdown({ refundAmountTaxIncl: "2000", originalItemAmountTaxIncl: "2000", originalCommission: moneyToString(moneyMul(taxInclToBreakdown(2000).taxExcl, 0.1)), campaignDiscount: "0" });
      const refund = await prisma.refund.create({
        data: { refundNumber: `RF-${uid()}`, orderId: r.results[0].orderId, refundType: RefundType.FULL, totalAmountTaxIncl: "2000", totalAmountTaxExcl: moneyToString(taxInclToBreakdown(2000).taxExcl), totalTaxAmount: moneyToString(taxInclToBreakdown(2000).taxAmount), reason: "模擬已提領後退款", processedAt: new Date(), processedBy: "simulator",
          items: { create: [{ orderItemId: r.results[0].orderItemId, refundAmountTaxIncl: "2000", refundAmountTaxExcl: moneyToString(taxInclToBreakdown(2000).taxExcl), refundTaxAmount: moneyToString(taxInclToBreakdown(2000).taxAmount), commissionRefund: moneyToString(bd.commissionRefund), campaignCostRecovery: "0", netMerchantDebit: moneyToString(bd.netMerchantDebit) }] },
        }, include: { items: true },
      });
      // Force negative balance entry
      const netDebit = bd.netMerchantDebit;
      const nbd = taxInclToBreakdown(netDebit);
      await LedgerService.createEntry(tx(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.NEGATIVE_BALANCE_CARRY, amount: nbd.taxIncl.negated(), amountTaxIncl: nbd.taxIncl.negated(), amountTaxExcl: nbd.taxExcl.negated(), taxAmount: nbd.taxAmount.negated(), referenceType: ReferenceType.REFUND_ITEM, referenceId: refund.items[0].id, idempotencyKey: `sim-neg-${refund.items[0].id}`, description: "模擬已提領後退款 - 負餘額" });
      await prisma.merchantWallet.update({ where: { id: m.wallet!.id }, data: { payoutSuspended: true } });
      const newBal = await LedgerService.getBalances(tx(), m.wallet!.id);
      return { message: `已提領後退款! 可用餘額: ${newBal.available}，提領已暫停` };
    }

    // 11. Reserve hold + release
    case "reserve_release": {
      const m = await getMerchant("B");
      // Check if reserve exists
      const bal = await LedgerService.getBalances(tx(), m.wallet!.id);
      if (bal.reserved.isZero()) {
        // Create order with reserve
        await createAndSettleOrder({ items: [{ merchantTaxId: "87654321", productName: "滑鼠墊", price: 400, commissionRate: 0.12 }] });
      }
      const bal2 = await LedgerService.getBalances(tx(), m.wallet!.id);
      if (bal2.reserved.isZero()) return { message: "商家B 無 Reserve 規則，請先到平台設定" };
      const releaseAmt = bal2.reserved.toString();
      await ReserveService.releaseReserve(pc(), { walletId: m.wallet!.id, amountTaxIncl: releaseAmt, reserveRuleId: "sim-release", reason: "模擬 Reserve 釋放" });
      return { message: `商家B Reserve NT$${releaseAmt} 已釋放回可用餘額` };
    }

    // 12. Manual adjustment credit + debit
    case "manual_adjustment": {
      const m = await getMerchant("A");
      const creditBd = taxInclToBreakdown(500);
      await LedgerService.createEntry(tx(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_CREDIT, amount: creditBd.taxIncl, amountTaxIncl: creditBd.taxIncl, amountTaxExcl: creditBd.taxExcl, taxAmount: creditBd.taxAmount, referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-c-${uid()}`, description: "模擬手動補發 NT$500" });
      const debitBd = taxInclToBreakdown(200);
      await LedgerService.createEntry(tx(), { walletId: m.wallet!.id, bucket: WalletBucket.AVAILABLE, entryType: LedgerEntryType.MANUAL_ADJUSTMENT_DEBIT, amount: debitBd.taxIncl.negated(), amountTaxIncl: debitBd.taxIncl.negated(), amountTaxExcl: debitBd.taxExcl.negated(), taxAmount: debitBd.taxAmount.negated(), referenceType: ReferenceType.SETTLEMENT_ADJUSTMENT, referenceId: uid(), idempotencyKey: `sim-adj-d-${uid()}`, description: "模擬手動扣回 NT$200" });
      return { message: "手動調整完成: 補發 NT$500 + 扣回 NT$200，淨增 NT$300" };
    }

    // 13. Bank account change
    case "bank_change": {
      const m = await getMerchant("A");
      const req = await prisma.merchantBankAccountChangeRequest.create({
        data: { merchantId: m.id, bankCode: "812", bankName: "台新銀行", branchCode: "0099", branchName: "模擬分行", accountNumber: "999888777666", accountName: "模擬新帳號", status: BankAccountChangeStatus.PENDING_REVIEW },
      });
      await prisma.merchantBankAccount.updateMany({ where: { merchantId: m.id, isActive: true }, data: { isActive: false } });
      await prisma.merchantBankAccount.create({
        data: { merchantId: m.id, bankCode: "812", bankName: "台新銀行", branchCode: "0099", branchName: "模擬分行", accountNumber: "999888777666", accountName: "模擬新帳號", isActive: true, effectiveAt: new Date() },
      });
      await prisma.merchantBankAccountChangeRequest.update({ where: { id: req.id }, data: { status: BankAccountChangeStatus.EFFECTIVE, reviewedAt: new Date(), reviewedBy: "simulator", effectiveAt: new Date() } });
      return { message: "銀行帳號變更: 申請 → 審核通過 → 台新銀行 ...7666 已生效" };
    }

    // 14. Idempotency test
    case "idempotency_test": {
      const idempKey = `idem-test-${uid()}`;
      // First call
      const res1 = await fetch(new URL("/api/webhooks/payment", process.env.NEXTAUTH_URL || "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: uid(), orderNumber: `ORD-IDEM-${uid()}`, merchantId: (await getMerchant("A")).id,
          items: [{ productName: "冪等測試商品", unitPriceTaxIncl: 100, quantity: 1, platformCommissionRate: 0.1 }],
          paidAt: new Date().toISOString(), idempotencyKey: idempKey,
        }),
      });
      const data1 = await res1.json();
      // Same key again
      const res2 = await fetch(new URL("/api/webhooks/payment", process.env.NEXTAUTH_URL || "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: uid(), orderNumber: `ORD-IDEM-DUP-${uid()}`, merchantId: (await getMerchant("A")).id,
          items: [{ productName: "冪等測試商品(重送)", unitPriceTaxIncl: 100, quantity: 1, platformCommissionRate: 0.1 }],
          paidAt: new Date().toISOString(), idempotencyKey: idempKey,
        }),
      });
      const data2 = await res2.json();
      const isDuplicate = data1.orderId === data2.orderId;
      return { message: `冪等測試: 第一次 orderId=${data1.orderId}，第二次 orderId=${data2.orderId}，${isDuplicate ? "相同 (冪等成功!)" : "不同 (冪等檢查有效)"}` };
    }

    // Reset all data
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
      // Re-create default bank accounts
      await prisma.merchantBankAccount.deleteMany();
      const mA = await prisma.merchant.findFirst({ where: { taxId: "12345678" } });
      const mB = await prisma.merchant.findFirst({ where: { taxId: "87654321" } });
      if (mA) await prisma.merchantBankAccount.create({ data: { merchantId: mA.id, bankCode: "004", bankName: "台灣銀行", branchCode: "0012", branchName: "信義分行", accountNumber: "012345678901", accountName: "測試商家A有限公司", isActive: true } });
      if (mB) await prisma.merchantBankAccount.create({ data: { merchantId: mB.id, bankCode: "812", bankName: "台新銀行", branchCode: "0088", branchName: "南京分行", accountNumber: "987654321012", accountName: "測試商家B有限公司", isActive: true } });
      return { message: "所有模擬資料已清除，系統已重置為初始狀態" };
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

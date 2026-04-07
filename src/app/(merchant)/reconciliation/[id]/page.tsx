export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getReconciliationDetail } from "@/server/queries/reconciliation.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { moneyFormat } from "@/lib/money";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function ReconciliationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const { id } = await params;
  const detail = await getReconciliationDetail(id, session.user.merchantId);
  if (!detail) notFound();

  const hiCoinTotal = detail.items.reduce((s, i) => s + Number(i.hiCoinAllocatedAmount.toString()), 0);
  const cashItemTotal = Number(detail.subOrderFinalItemAmount.toString()) - hiCoinTotal;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reconciliation"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />返回列表</Button></Link>
        <div>
          <h2 className="text-2xl font-bold">子單詳情</h2>
          <p className="text-muted-foreground">{detail.order.orderNumber}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== 區塊一：訂單資訊 ===== */}
        <Card>
          <CardHeader><CardTitle className="text-base">訂單資訊</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground mb-2">商品明細與消費者付款方式</p>

            {detail.items.map((item) => {
              const hiCoin = Number(item.hiCoinAllocatedAmount.toString());
              const cash = Number(item.finalPriceBeforeHiCoin.toString()) - hiCoin;
              return (
                <div key={item.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex justify-between font-medium">
                    <span>{item.orderItem.productName} × {item.quantity}</span>
                    <span>NT$ {Number(item.finalPriceBeforeHiCoin.toString()).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>VIP 成交價</span>
                    <span>NT$ {Number(item.finalPriceBeforeHiCoin.toString()).toLocaleString()}</span>
                  </div>
                  {hiCoin > 0 && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">台幣支付</span>
                        <span>NT$ {cash.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-amber-600">
                        <span>嗨幣折抵</span>
                        <span>-{hiCoin.toLocaleString()} 嗨幣</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <Separator />

            <Row label="子單商品成交總額" value={`NT$ ${Number(detail.subOrderFinalItemAmount.toString()).toLocaleString()}`} />
            {hiCoinTotal > 0 && (
              <>
                <Row label="消費者台幣支付" value={`NT$ ${cashItemTotal.toLocaleString()}`} />
                <Row label="消費者嗨幣折抵" value={<span className="text-amber-600">-{hiCoinTotal.toLocaleString()} 嗨幣（平台補貼）</span>} />
              </>
            )}
            <Row label="運費" value={
              Number(detail.subOrderShippingFee.toString()) > 0
                ? <span className="text-green-600">NT$ {Number(detail.subOrderShippingFee.toString()).toLocaleString()}（歸商家，參與金流費）</span>
                : <span className="text-muted-foreground">免運（商店吸收）</span>
            } />
            <Row label="消費者總付" value={
              <span className="font-medium">NT$ {(cashItemTotal + Number(detail.subOrderShippingFee.toString())).toLocaleString()}
              {hiCoinTotal > 0 ? ` + ${hiCoinTotal} 嗨幣` : ""}</span>
            } />
          </CardContent>
        </Card>

        {/* ===== 區塊二：費用拆解與商家結算 ===== */}
        <Card>
          <CardHeader><CardTitle className="text-base">費用拆解與商家結算</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground mb-2">平台費用扣除與商家應得計算</p>

            <Row label="結算基礎（商家券折後）" value={<span className="font-medium">NT$ {Number(detail.subOrderSettlementBaseAmount.toString()).toLocaleString()}</span>} />

            <Separator />
            <p className="text-xs text-muted-foreground">扣款項</p>

            <Row label={`商店抽成 (${(Number(detail.storeCommissionRate.toString()) * 100).toFixed(1)}%)`}
              value={<span className="text-red-600">-{Number(detail.storeCommissionAmount.toString()).toLocaleString()}</span>} />
            <Row label={`分類抽成 (${(Number(detail.categoryCommissionRate.toString()) * 100).toFixed(1)}%)`}
              value={<span className="text-red-600">-{Number(detail.categoryCommissionAmount.toString()).toLocaleString()}</span>} />

            {(() => {
              const feeBase = Number(detail.subOrderFinalItemAmount.toString()) + Number(detail.subOrderShippingFee.toString());
              return (
                <Row label={`金流費 (商品${Number(detail.subOrderFinalItemAmount.toString())}+運費${Number(detail.subOrderShippingFee.toString())}=${feeBase} × 費率)`}
                  value={<span className="text-red-600">-{Number(detail.estimatedPaymentFeeAmount.toString()).toLocaleString()}</span>} />
              );
            })()}

            <Row label="發票費（固定，不可退）" value={<span className="text-red-600">-{Number(detail.invoiceFeeAmount.toString()).toLocaleString()}</span>} />

            {Number(detail.referralRewardCost?.toString() || "0") > 0 && (
              <Row label="推薦碼獎勵成本（商家承擔）" value={<span className="text-orange-600">-{Number(detail.referralRewardCost.toString()).toLocaleString()}</span>} />
            )}
            {Number(detail.listGuideRewardCost?.toString() || "0") > 0 && (
              <Row label="清單導購獎勵成本（商家承擔）" value={<span className="text-orange-600">-{Number(detail.listGuideRewardCost.toString()).toLocaleString()}</span>} />
            )}

            <Separator />
            <p className="text-xs text-muted-foreground">加項</p>

            <Row label="運費（歸商家，不參與抽成）" value={
              Number(detail.subOrderShippingFee.toString()) > 0
                ? <span className="text-green-600">+{Number(detail.subOrderShippingFee.toString()).toLocaleString()}</span>
                : <span className="text-muted-foreground">0（免運）</span>
            } />

            {hiCoinTotal > 0 && (
              <Row label="嗨幣折抵（平台補貼，不影響商家）" value={<span className="text-amber-600">{hiCoinTotal.toLocaleString()} (資訊欄)</span>} />
            )}

            {Number(detail.platformAbsorbedAmount.toString()) > 0 && (
              <Row label="平台吸收差額（商家最低保護 0）" value={<span className="text-purple-600">+{Number(detail.platformAbsorbedAmount.toString()).toLocaleString()}</span>} />
            )}

            <Separator />
            <div className="flex items-start justify-between pt-2">
              <span className="font-bold text-base">商家應得</span>
              <span className="font-bold text-xl">{moneyFormat(detail.merchantReceivableAmount.toString())}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 結算快照 */}
      {detail.snapshots.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">結算快照</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {detail.snapshots.map((snap) => (
                <div key={snap.id} className="flex items-center justify-between rounded border p-2">
                  <div>
                    <span className="font-mono text-xs">{snap.snapshotType}</span>
                    <span className="ml-2 text-muted-foreground">{snap.reasonCode}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground">{snap.amountBefore.toString()} →</span>
                    <span className="ml-1 font-medium">{snap.amountAfter.toString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ledger 事件流 */}
      <Card>
        <CardHeader><CardTitle className="text-base">帳務事件流 (Ledger)</CardTitle></CardHeader>
        <CardContent>
          <LedgerTimeline
            entries={detail.ledgerEntries.map((e) => ({
              id: e.id, entryType: e.entryType, bucket: e.bucket,
              amount: e.amount.toString(), amountTaxIncl: e.amountTaxIncl.toString(),
              amountTaxExcl: e.amountTaxExcl.toString(), balanceAfter: e.balanceAfter.toString(),
              description: e.description, createdAt: e.createdAt,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground text-xs">{label}</span><span className="text-right shrink-0">{value}</span></div>;
}

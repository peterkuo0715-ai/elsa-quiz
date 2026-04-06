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
        {/* 商品明細 */}
        <Card>
          <CardHeader><CardTitle className="text-base">商品明細</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detail.items.map((item) => (
              <div key={item.id} className="flex justify-between">
                <span>{item.orderItem.productName} × {item.quantity}</span>
                <span>{moneyFormat(item.finalPriceBeforeHiCoin.toString())}</span>
              </div>
            ))}
            {detail.items.some((i) => Number(i.hiCoinAllocatedAmount.toString()) > 0) && (
              <>
                <Separator />
                {detail.items.filter((i) => Number(i.hiCoinAllocatedAmount.toString()) > 0).map((item) => (
                  <div key={`hc-${item.id}`} className="flex justify-between text-amber-600">
                    <span>嗨幣折抵 ({item.orderItem.productName})</span>
                    <span>-{item.hiCoinAllocatedAmount.toString()}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* 費用拆解 (PRD Section 10) */}
        <Card>
          <CardHeader><CardTitle className="text-base">費用拆解</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="子單商品成交總額" value={moneyFormat(detail.subOrderFinalItemAmount.toString())} />
            <Row label="結算基礎（商家券折後）" value={moneyFormat(detail.subOrderSettlementBaseAmount.toString())} />
            <Separator />
            <Row label={`商店抽成 (${Number(detail.storeCommissionRate.toString()) * 100}%)`} value={<span className="text-red-600">-{detail.storeCommissionAmount.toString()}</span>} />
            <Row label={`分類抽成 (${Number(detail.categoryCommissionRate.toString()) * 100}%)`} value={<span className="text-red-600">-{detail.categoryCommissionAmount.toString()}</span>} />
            <Row label="金流費" value={<span className="text-red-600">-{detail.estimatedPaymentFeeAmount.toString()}</span>} />
            <Row label="發票費（不可退）" value={<span className="text-red-600">-{detail.invoiceFeeAmount.toString()}</span>} />
            <Row label="運費" value={<span className="text-green-600">+{detail.subOrderShippingFee.toString()}</span>} />
            {Number(detail.subOrderHiCoinAllocated.toString()) > 0 && (
              <Row label="嗨幣折抵（平台補貼，不影響商家）" value={<span className="text-amber-600">{detail.subOrderHiCoinAllocated.toString()} (資訊欄)</span>} />
            )}
            {Number(detail.platformAbsorbedAmount.toString()) > 0 && (
              <Row label="平台吸收差額" value={<span className="text-purple-600">{detail.platformAbsorbedAmount.toString()}</span>} />
            )}
            <Separator />
            <Row label="商家應得" value={<span className="font-bold text-lg">{moneyFormat(detail.merchantReceivableAmount.toString())}</span>} />
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
  return <div className="flex items-start justify-between"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>;
}

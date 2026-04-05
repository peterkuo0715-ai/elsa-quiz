import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getReconciliationDetail } from "@/server/queries/reconciliation.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StateBadge } from "@/components/state-badge";
import { AmountDisplay } from "@/components/amount-display";
import { LedgerTimeline } from "@/components/ledger-timeline";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function ReconciliationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const { id } = await params;
  const detail = await getReconciliationDetail(id, session.user.merchantId);
  if (!detail) notFound();

  const formatDate = (d: Date | string | null | undefined) =>
    d ? format(new Date(d), "yyyy/MM/dd HH:mm:ss", { locale: zhTW }) : "-";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reconciliation">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回列表
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold">對帳明細詳情</h2>
          <p className="text-muted-foreground">
            訂單 {detail.orderItem.order.orderNumber} -{" "}
            {detail.orderItem.productName}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 基本資訊 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">訂單資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="訂單編號" value={detail.orderItem.order.orderNumber} />
            <Row label="商品名稱" value={detail.orderItem.productName} />
            <Row label="SKU" value={detail.orderItem.sku || "-"} />
            <Row label="店鋪" value={detail.orderItem.store?.name || "-"} />
            <Row
              label="數量"
              value={detail.orderItem.quantity.toString()}
            />
            <Row
              label="狀態"
              value={<StateBadge status={detail.status} />}
            />
          </CardContent>
        </Card>

        {/* 金額明細 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">金額計算</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="商品金額"
              value={
                <AmountDisplay
                  taxIncl={detail.productAmount.toString()}
                  taxExcl={detail.taxExcludedAmount.toString()}
                />
              }
            />
            <Row
              label="平台抽成"
              value={
                <span className="text-red-600">
                  -{detail.commissionAmount.toString()} (
                  {(Number(detail.commissionRate) * 100).toFixed(1)}%)
                </span>
              }
            />
            <Row
              label="運費收入"
              value={<span className="text-green-600">+{detail.shippingAmount.toString()}</span>}
            />
            <Row
              label="金流手續費"
              value={<span className="text-red-600">-{detail.paymentFeeAmount.toString()}</span>}
            />
            {Number(detail.promotionCostAmount.toString()) > 0 && (
              <Row
                label="商家活動成本"
                value={<span className="text-orange-600">-{detail.promotionCostAmount.toString()}</span>}
              />
            )}
            {Number(detail.hiCoinRedeemedAmount.toString()) > 0 && (
              <Row
                label="嗨幣折抵"
                value={<span className="text-amber-600">{detail.hiCoinRedeemedAmount.toString()}</span>}
              />
            )}
            {Number(detail.hiCoinCampaignCostAmount.toString()) > 0 && (
              <Row
                label="嗨幣活動成本"
                value={<span className="text-orange-600">-{detail.hiCoinCampaignCostAmount.toString()}</span>}
              />
            )}
            {Number(detail.platformSubsidyAmount.toString()) > 0 && (
              <Row
                label="平台嗨幣補貼"
                value={<span className="text-blue-600">+{detail.platformSubsidyAmount.toString()}</span>}
              />
            )}
            {Number(detail.reserveAmount.toString()) > 0 && (
              <Row
                label="Reserve 扣留"
                value={
                  <span className="text-blue-600">
                    -{detail.reserveAmount.toString()}
                  </span>
                }
              />
            )}
            <Separator />
            <Row
              label="商家淨額"
              value={
                <AmountDisplay
                  taxIncl={detail.netSettlementAmount.toString()}
                  taxExcl={detail.taxExcludedAmount.toString()}
                  className="font-bold"
                />
              }
            />
          </CardContent>
        </Card>

        {/* 時間軸 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">時間線</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="付款時間" value={formatDate(detail.paidAt)} />
            <Row label="出貨時間" value={formatDate(detail.shippedAt)} />
            <Row label="到貨時間" value={formatDate(detail.deliveredAt)} />
            <Row
              label="鑑賞期截止"
              value={formatDate(detail.appreciationEndsAt)}
            />
            <Row label="結算日" value={formatDate(detail.settledAt)} />
            {detail.batch && (
              <Row label="結算批次" value={detail.batch.batchNumber} />
            )}
          </CardContent>
        </Card>

        {/* 關聯退款 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">關聯退款</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.orderItem.refundItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">無退款紀錄</p>
            ) : (
              <div className="space-y-2">
                {detail.orderItem.refundItems.map((ri) => (
                  <div
                    key={ri.refund.refundNumber}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <span>{ri.refund.refundNumber}</span>
                    <span className="text-red-600">
                      -{ri.refundAmountTaxIncl.toString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ledger 事件流 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">帳務事件流 (Ledger)</CardTitle>
        </CardHeader>
        <CardContent>
          <LedgerTimeline
            entries={detail.ledgerEntries.map((e) => ({
              id: e.id,
              entryType: e.entryType,
              bucket: e.bucket,
              amount: e.amount.toString(),
              amountTaxIncl: e.amountTaxIncl.toString(),
              amountTaxExcl: e.amountTaxExcl.toString(),
              balanceAfter: e.balanceAfter.toString(),
              description: e.description,
              createdAt: e.createdAt,
            }))}
          />
        </CardContent>
      </Card>

      {/* 爭議 */}
      {detail.disputes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">關聯爭議</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {detail.disputes.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{d.caseNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.disputeReason}
                    </p>
                  </div>
                  <div className="text-right">
                    <StateBadge status={d.status} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      爭議金額: {d.disputeAmountTaxIncl.toString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 稽核紀錄 */}
      {detail.auditLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">稽核紀錄</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {detail.auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between rounded border p-2"
                >
                  <div>
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.user?.name || "System"} -{" "}
                      {formatDate(log.createdAt)}
                    </p>
                  </div>
                  {log.reason && (
                    <p className="text-xs text-muted-foreground">
                      {log.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

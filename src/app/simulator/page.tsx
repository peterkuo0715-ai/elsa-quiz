"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Wallet, Coins, Store } from "lucide-react";

interface ConsumerAccount { cash: number; hiCoin: number; }
interface OrderState { orderId: string; orderNumber: string; type: "cash" | "hicoin"; settled: boolean; executedL3: Set<string>; }

const L2_ITEMS = [
  { id: "pending", label: "鑑賞期中（未結算）", icon: "⏳" },
  { id: "settled", label: "正常完成（鑑賞期後結算）", icon: "✅" },
  { id: "problem", label: "鑑賞期後有問題", icon: "⚠️" },
];

const L3_MAP: Record<string, Array<{ id: string; label: string; desc: string }>> = {
  pending: [
    { id: "show_pending", label: "查看狀態", desc: "款項在 Pending 中，不可提領" },
    { id: "refund_in_appreciation", label: "鑑賞期內退款", desc: "尚未結算就全額退款" },
  ],
  settled: [
    { id: "payout_success", label: "商家提領成功", desc: "全額提領 → 銀行匯款成功" },
    { id: "payout_failure", label: "商家提領失敗", desc: "提領失敗 → 自動退回 wallet" },
    { id: "reserve_release", label: "Reserve 釋放", desc: "扣留的保留金釋放回可用" },
  ],
  problem: [
    { id: "partial_refund", label: "部分退貨（退1件）", desc: "退第一件商品，第二件保留" },
    { id: "full_refund", label: "全額退款", desc: "全部退款（嗨幣原路返回）" },
    { id: "dispute_resolve", label: "爭議 → 凍結 → 解除", desc: "凍結500 → 商家勝訴 → 解凍" },
    { id: "dispute_debit", label: "爭議 → 凍結 → 扣回", desc: "凍結500 → 商家敗訴 → 永久扣回" },
    { id: "negotiated_refund", label: "協商退款（退NT$1,000）", desc: "協商只退部分金額，非整件退" },
    { id: "negative_balance_refund", label: "已提領後退款（負餘額）", desc: "先提領再退款 → 負餘額暫停提領" },
    { id: "manual_adjustment", label: "手動調整單", desc: "補發+300 / 扣回-100" },
  ],
};

const INITIAL_CONSUMER: ConsumerAccount = { cash: 50000, hiCoin: 1000 };

export default function SimulatorPage() {
  const [consumer, setConsumer] = useState<ConsumerAccount>({ ...INITIAL_CONSUMER });
  const [orders, setOrders] = useState<OrderState[]>([]);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [expandedL2, setExpandedL2] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState(false);

  async function api(body: Record<string, unknown>) {
    const res = await fetch("/api/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  }

  async function handleCreateOrder(type: "cash" | "hicoin") {
    const key = `create-${type}`;
    setLoading(key);
    const data = await api({ action: "create_order", type });
    setLoading(null);
    if (data.success) {
      const debit = data.consumerDebit;
      setConsumer((c) => ({ cash: c.cash - Number(debit.cash), hiCoin: c.hiCoin - Number(debit.hiCoin) }));
      const newOrder: OrderState = { orderId: data.orderId, orderNumber: data.orderNumber, type, settled: false, executedL3: new Set() };
      setOrders((prev) => [...prev, newOrder]);
      setExpandedOrder(orders.length);
      setMessages((m) => ({ ...m, [data.orderId]: `已建立: ${data.items}\n消費者付: 台幣${debit.cash} + 嗨幣${debit.hiCoin}` }));
    } else {
      setMessages((m) => ({ ...m, [key]: data.message }));
    }
  }

  async function handleL2(orderIdx: number, l2Id: string) {
    const order = orders[orderIdx];
    if (l2Id === "settled" && !order.settled) {
      setLoading(`${order.orderId}-settle`);
      const data = await api({ action: "settle", orderId: order.orderId });
      setLoading(null);
      if (data.success) {
        setOrders((prev) => prev.map((o, i) => i === orderIdx ? { ...o, settled: true } : o));
        setMessages((m) => ({ ...m, [`${order.orderId}-settled`]: data.message }));
      }
    }
    if (l2Id === "problem" && !order.settled) {
      // Auto-settle first
      setLoading(`${order.orderId}-settle`);
      const data = await api({ action: "settle", orderId: order.orderId });
      setLoading(null);
      if (data.success) {
        setOrders((prev) => prev.map((o, i) => i === orderIdx ? { ...o, settled: true } : o));
      }
    }
    setExpandedL2(expandedL2 === `${orderIdx}-${l2Id}` ? null : `${orderIdx}-${l2Id}`);
  }

  async function handleL3(orderIdx: number, actionId: string) {
    const order = orders[orderIdx];
    if (actionId === "show_pending") {
      setMessages((m) => ({ ...m, [`${order.orderId}-show_pending`]: "款項在 Pending bucket，鑑賞期 7 天後才會轉入 Available。目前不可提領。" }));
      return;
    }
    const key = `${order.orderId}-${actionId}`;
    setLoading(key);
    const data = await api({ action: actionId, orderId: order.orderId });
    setLoading(null);
    if (data.success) {
      setOrders((prev) => prev.map((o, i) => i === orderIdx ? { ...o, executedL3: new Set([...o.executedL3, actionId]) } : o));
      if (data.consumerRefund) {
        setConsumer((c) => ({ cash: c.cash + Number(data.consumerRefund.cash), hiCoin: c.hiCoin + Number(data.consumerRefund.hiCoin) }));
      }
    }
    setMessages((m) => ({ ...m, [key]: data.message || data.error || "失敗" }));
  }

  async function handleReset() {
    if (!confirm("確定清除所有模擬資料？")) return;
    setResetting(true);
    await api({ action: "reset" });
    setConsumer({ ...INITIAL_CONSUMER });
    setOrders([]);
    setExpandedOrder(null);
    setExpandedL2(null);
    setMessages({});
    setResetting(false);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar: Consumer Account */}
      <div className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="inline h-4 w-4" /> 返回</Link>
            <h1 className="text-lg font-bold">POC 場景模擬器 v2</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2">
              <Wallet className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">消費者</span>
              <span className="font-mono text-sm">台幣 <strong className="text-blue-700">{consumer.cash.toLocaleString()}</strong></span>
              <span className="text-gray-300">|</span>
              <Coins className="h-4 w-4 text-amber-500" />
              <span className="font-mono text-sm">嗨幣 <strong className="text-amber-600">{consumer.hiCoin.toLocaleString()}</strong></span>
            </div>
            <button onClick={handleReset} disabled={resetting} className="flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
              <RotateCcw className={`h-3 w-3 ${resetting ? "animate-spin" : ""}`} /> 重置
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {/* L1: Payment buttons */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase">第一步：選擇付款方式（建立訂單）</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <button onClick={() => handleCreateOrder("cash")} disabled={loading !== null}
              className="rounded-xl border-2 border-green-200 bg-white p-5 text-left transition hover:border-green-400 hover:shadow disabled:opacity-50">
              {loading === "create-cash" ? <Loader2 className="h-5 w-5 animate-spin text-green-500 mb-2" /> : <Wallet className="h-6 w-6 text-green-600 mb-2" />}
              <h3 className="font-semibold">A. 純台幣付款</h3>
              <p className="mt-1 text-sm text-gray-500">藍芽耳機 NT$1,500 + 保護殼 NT$500 + 運費80</p>
              <p className="text-xs text-gray-400 mt-1">抽成10% + 金流費2.8%</p>
            </button>
            <button onClick={() => handleCreateOrder("hicoin")} disabled={loading !== null}
              className="rounded-xl border-2 border-amber-200 bg-white p-5 text-left transition hover:border-amber-400 hover:shadow disabled:opacity-50">
              {loading === "create-hicoin" ? <Loader2 className="h-5 w-5 animate-spin text-amber-500 mb-2" /> : <Coins className="h-6 w-6 text-amber-600 mb-2" />}
              <h3 className="font-semibold">B. 台幣 + 嗨幣付款</h3>
              <p className="mt-1 text-sm text-gray-500">藍芽音箱 NT$1,900 + 底座 NT$600 + 運費80</p>
              <p className="text-xs text-gray-400 mt-1">嗨幣折抵各200 (平台補貼) + 抽成10% + 金流費2.8%</p>
            </button>
          </div>
        </div>

        {/* Orders (L2 + L3) */}
        {orders.map((order, orderIdx) => (
          <div key={order.orderId} className="rounded-xl border bg-white overflow-hidden">
            {/* Order header */}
            <button onClick={() => setExpandedOrder(expandedOrder === orderIdx ? null : orderIdx)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-gray-50">
              <div className="flex items-center gap-3">
                {order.type === "cash" ? <Wallet className="h-5 w-5 text-green-600" /> : <Coins className="h-5 w-5 text-amber-600" />}
                <div>
                  <span className="font-semibold text-sm">{order.orderNumber}</span>
                  <span className="ml-2 text-xs text-gray-400">{order.type === "cash" ? "純台幣" : "台幣+嗨幣"}</span>
                  {order.settled && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">已結算</span>}
                </div>
              </div>
              {expandedOrder === orderIdx ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </button>

            {/* Order creation message */}
            {messages[order.orderId] && (
              <div className="mx-4 mb-2 rounded bg-blue-50 p-2 text-xs text-blue-800 whitespace-pre-wrap">{messages[order.orderId]}</div>
            )}

            {/* L2 + L3 */}
            {expandedOrder === orderIdx && (
              <div className="border-t px-4 pb-4 pt-2 space-y-2">
                {L2_ITEMS.map((l2) => {
                  const l2Key = `${orderIdx}-${l2.id}`;
                  const isExpanded = expandedL2 === l2Key;
                  const l3Items = L3_MAP[l2.id] || [];

                  return (
                    <div key={l2.id} className="rounded-lg border">
                      <button onClick={() => handleL2(orderIdx, l2.id)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                        <span className="text-sm">
                          <span className="mr-2">{l2.icon}</span>
                          <span className="font-medium">{l2.label}</span>
                          {l2.id === "settled" && !order.settled && <span className="ml-2 text-xs text-gray-400">(點擊執行結算)</span>}
                        </span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </button>

                      {messages[`${order.orderId}-settled`] && l2.id === "settled" && (
                        <div className="mx-4 mb-2 rounded bg-green-50 p-2 text-xs text-green-800">{messages[`${order.orderId}-settled`]}</div>
                      )}

                      {isExpanded && (
                        <div className="border-t px-4 pb-3 pt-2 space-y-2">
                          {l3Items.map((l3) => {
                            const executed = order.executedL3.has(l3.id);
                            const msgKey = `${order.orderId}-${l3.id}`;
                            const isLoading = loading === msgKey;
                            const msg = messages[msgKey];

                            // Check if action should be disabled (mutual exclusion)
                            const refundActions = ["partial_refund", "full_refund", "negotiated_refund", "refund_in_appreciation", "negative_balance_refund"];
                            const hasRefund = refundActions.some((a) => order.executedL3.has(a));
                            const isRefund = refundActions.includes(l3.id);
                            const disabled = executed || isLoading || (isRefund && hasRefund && !executed);

                            return (
                              <div key={l3.id}>
                                <button onClick={() => handleL3(orderIdx, l3.id)} disabled={disabled}
                                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                                    executed ? "bg-gray-50 text-gray-400 border-gray-200" :
                                    disabled ? "bg-gray-50 text-gray-300 cursor-not-allowed" :
                                    "hover:bg-blue-50 hover:border-blue-300"
                                  }`}>
                                  <div>
                                    <span className="font-medium">{l3.label}</span>
                                    <span className="ml-2 text-xs text-gray-400">{l3.desc}</span>
                                  </div>
                                  <div className="shrink-0 ml-2">
                                    {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                                    {executed && <CheckCircle className="h-4 w-4 text-green-500" />}
                                  </div>
                                </button>
                                {msg && (
                                  <div className={`mt-1 rounded p-2 text-xs whitespace-pre-wrap ${executed || msg.includes("Available") || msg.includes("成功") || msg.includes("完成") || msg.includes("Pending") ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                                    {msg}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {orders.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400">
            請點擊上方付款方式建立訂單，開始模擬
          </div>
        )}
      </div>
    </div>
  );
}

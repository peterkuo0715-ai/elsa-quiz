"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Loader2, Wallet, Coins } from "lucide-react";

interface ConsumerAccount { cash: number; hiCoin: number; }
const INITIAL: ConsumerAccount = { cash: 50000, hiCoin: 1000 };

type L1 = "single" | "multi";
type LShipping = "shipping_paid" | "free_shipping";
type L2 = "cash" | "hicoin" | "hicoin_platform_coupon" | "hicoin_merchant_coupon";
type LGuide = "no_guide" | "referral" | "list_guide";
type L3 = "full_pay" | "installment";
type L4 = "settled" | "pending" | "dispute" | "negotiated" | "full_refund" | "adjudicated" | "partial_return";

const L1_OPTIONS: Array<{ id: L1; label: string; desc: string }> = [
  { id: "single", label: "單商品", desc: "藍芽耳機 NT$1,400 (會員價) × 1件" },
  { id: "multi", label: "多商品", desc: "藍芽耳機 NT$1,400 + 保護殼 NT$450" },
];
const SHIPPING_OPTIONS: Array<{ id: LShipping; label: string; desc: string }> = [
  { id: "shipping_paid", label: "運費外加 NT$80", desc: "消費者付運費，平台代收，歸商家" },
  { id: "free_shipping", label: "免運", desc: "運費=0，商店吸收，不參與任何計算" },
];
const L2_OPTIONS: Array<{ id: L2; label: string; desc: string }> = [
  { id: "cash", label: "純台幣", desc: "全額台幣付款" },
  { id: "hicoin", label: "台幣 + 嗨幣", desc: "嗨幣折抵200 (平台吸收)" },
  { id: "hicoin_platform_coupon", label: "嗨幣 + 平台券", desc: "嗨幣200 + 平台券-100 (不影響抽成)" },
  { id: "hicoin_merchant_coupon", label: "嗨幣 + 商家券", desc: "嗨幣200 + 商家券-100 (影響抽成基礎)" },
];
const GUIDE_OPTIONS: Array<{ id: LGuide; label: string; desc: string }> = [
  { id: "no_guide", label: "無導購", desc: "一般購買，無推薦/導購" },
  { id: "referral", label: "推薦碼", desc: "推薦碼折扣10%，推薦人獎勵50嗨幣/件（商家出）" },
  { id: "list_guide", label: "清單導購", desc: "不改變價格，清單建立者獎勵80嗨幣/件（商家出）" },
];
const L3_OPTIONS: Array<{ id: L3; label: string; desc: string }> = [
  { id: "full_pay", label: "一次付清", desc: "金流費 2%" },
  { id: "installment", label: "信用卡分期", desc: "金流費 3.5%" },
];
const L4_OPTIONS: Array<{ id: L4; label: string; desc: string; needAmount?: boolean; multiOnly?: boolean }> = [
  { id: "settled", label: "過鑑賞期", desc: "正常完成，結算入帳" },
  { id: "pending", label: "未過鑑賞期", desc: "鑑賞期中，Pending 狀態" },
  { id: "dispute", label: "爭議處理中", desc: "消費者發起售後，商家應得全額凍結" },
  { id: "negotiated", label: "協商退款", desc: "雙方協議退款金額", needAmount: true },
  { id: "full_refund", label: "全額退款", desc: "全部退款，原路返回" },
  { id: "adjudicated", label: "裁決退款", desc: "平台裁決退款金額", needAmount: true },
  { id: "partial_return", label: "部分退貨", desc: "退第1件商品", multiOnly: true },
];

export default function SimulatorPage() {
  const [consumer, setConsumer] = useState<ConsumerAccount>({ ...INITIAL });
  const [l1, setL1] = useState<L1 | null>(null);
  const [lShipping, setLShipping] = useState<LShipping | null>(null);
  const [l2, setL2] = useState<L2 | null>(null);
  const [lGuide, setLGuide] = useState<LGuide | null>(null);
  const [l3, setL3] = useState<L3 | null>(null);
  const [l4, setL4] = useState<L4 | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [results, setResults] = useState<Array<{ orderNumber: string; details: string }>>([]);

  const needsAmount = l4 === "negotiated" || l4 === "adjudicated";
  const canExecute = l1 && lShipping && l2 && lGuide && l3 && l4 && (!needsAmount || Number(refundAmount) > 0);

  async function handleExecute() {
    if (!canExecute) return;
    setLoading(true);
    try {
      const res = await fetch("/api/simulator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute", l1, lShipping, l2, lGuide, l3, l4,
          ...(needsAmount ? { refundAmount: Number(refundAmount) } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Update consumer account
        const debit = data.consumerDebit;
        const refund = data.consumerRefund;
        setConsumer((c) => ({
          cash: c.cash - Number(debit.cash) + Number(refund.cash),
          hiCoin: c.hiCoin - Number(debit.hiCoin) + Number(refund.hiCoin),
        }));
        setResults((prev) => [{ orderNumber: data.orderNumber, details: data.details }, ...prev]);
      } else {
        setResults((prev) => [{ orderNumber: "ERROR", details: data.message }, ...prev]);
      }
    } catch {
      setResults((prev) => [{ orderNumber: "ERROR", details: "網路錯誤" }, ...prev]);
    }
    setLoading(false);
    // Reset selections for next order
    setL4(null);
    setRefundAmount("");
  }

  async function handleReset() {
    if (!confirm("確定清除所有模擬資料？")) return;
    setResetting(true);
    await fetch("/api/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
    setConsumer({ ...INITIAL });
    setL1(null); setLShipping(null); setL2(null); setLGuide(null); setL3(null); setL4(null);
    setRefundAmount("");
    setResults([]);
    setResetting(false);
  }

  function Card({ selected, onClick, label, desc, disabled }: { selected: boolean; onClick: () => void; label: string; desc: string; disabled?: boolean }) {
    return (
      <button onClick={onClick} disabled={disabled}
        className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
          disabled ? "opacity-30 cursor-not-allowed border-gray-200" :
          selected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-gray-200 hover:border-gray-400 bg-white"
        }`}>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="inline h-4 w-4" /> 返回</Link>
            <h1 className="text-lg font-bold">POC 場景模擬器</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2">
              <Wallet className="h-4 w-4 text-blue-600" />
              <span className="text-sm">消費者</span>
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

      <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
        {/* L1 */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">L1 商品數量</h2>
          <div className="grid grid-cols-2 gap-3">
            {L1_OPTIONS.map((o) => <Card key={o.id} selected={l1 === o.id} onClick={() => setL1(o.id)} label={o.label} desc={o.desc} />)}
          </div>
        </div>

        {/* Shipping */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">運費模式</h2>
          <div className="grid grid-cols-2 gap-3">
            {SHIPPING_OPTIONS.map((o) => <Card key={o.id} selected={lShipping === o.id} onClick={() => setLShipping(o.id)} label={o.label} desc={o.desc} />)}
          </div>
        </div>

        {/* L2 */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">L2 付款金額</h2>
          <div className="grid grid-cols-2 gap-3">
            {L2_OPTIONS.map((o) => <Card key={o.id} selected={l2 === o.id} onClick={() => setL2(o.id)} label={o.label} desc={o.desc} />)}
          </div>
        </div>

        {/* Guide Source */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">導購來源 <span className="text-green-600">(PRD v3)</span></h2>
          <div className="grid grid-cols-3 gap-3">
            {GUIDE_OPTIONS.map((o) => <Card key={o.id} selected={lGuide === o.id} onClick={() => setLGuide(o.id)} label={o.label} desc={o.desc} />)}
          </div>
        </div>

        {/* L3 */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">L3 付款方式</h2>
          <div className="grid grid-cols-2 gap-3">
            {L3_OPTIONS.map((o) => <Card key={o.id} selected={l3 === o.id} onClick={() => setL3(o.id)} label={o.label} desc={o.desc} />)}
          </div>
        </div>

        {/* L4 */}
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">L4 訂單結果狀態</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {L4_OPTIONS.map((o) => {
              const disabled = o.multiOnly && l1 !== "multi";
              return <Card key={o.id} selected={l4 === o.id} onClick={() => { setL4(o.id); if (!o.needAmount) setRefundAmount(""); }} label={o.label} desc={o.desc} disabled={disabled} />;
            })}
          </div>
          {/* Amount input */}
          {needsAmount && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-gray-600">{l4 === "adjudicated" ? "裁決退款金額:" : "協商退款金額:"}</span>
              <input type="number" min="1" placeholder="輸入金額" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)}
                className="w-40 rounded-md border px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              <span className="text-xs text-gray-400">NT$</span>
            </div>
          )}
        </div>

        {/* Execute */}
        <button onClick={handleExecute} disabled={!canExecute || loading}
          className={`w-full rounded-xl py-4 text-center font-semibold text-white transition ${
            canExecute && !loading ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-300 cursor-not-allowed"
          }`}>
          {loading ? <Loader2 className="inline h-5 w-5 animate-spin" /> : "執行"}
        </button>

        {/* Link to rewards simulator */}
        <div className="text-center">
          <a href="/simulator-rewards" className="inline-flex items-center gap-2 rounded-md border-2 border-dashed border-purple-300 px-4 py-2 text-sm text-purple-600 hover:border-purple-500 hover:text-purple-800 transition-colors">
            🎁 導購獎勵模擬器（推薦碼 / 清單導購）
          </a>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase">執行結果</h2>
            {results.map((r, i) => (
              <div key={i} className={`rounded-lg border p-4 text-sm whitespace-pre-wrap ${r.orderNumber === "ERROR" ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800"}`}>
                <p className="font-mono text-xs text-gray-500 mb-1">{r.orderNumber}</p>
                {r.details}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

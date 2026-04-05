"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Scenario { id: string; title: string; description: string; details: string[]; color: string; category: string; }

const SCENARIOS: Scenario[] = [
  // 結算
  { id: "pending_appreciation", title: "0. 鑑賞期中（未結算）", description: "已到貨但 7 天未過，款項在 Pending", details: ["無線充電盤 NT$1,800", "含金流費 2.8% + 運費 NT$60", "Pending 中，不可提領"], color: "border-yellow-300 hover:border-yellow-500", category: "結算" },
  { id: "normal_settlement", title: "1. 正常結算（全費用拆解）", description: "含金流費+運費+抽成完整拆解", details: ["藍芽耳機 NT$1,500 + 運費 NT$80", "抽成 10% + 金流費 2.8%", "公式: 商品+運費-抽成-金流費=淨額"], color: "border-green-300 hover:border-green-500", category: "結算" },
  { id: "multi_merchant", title: "2. 多商家訂單拆分", description: "商家A+B 各自獨立結算", details: ["商家A: 滑鼠 NT$800 (10%)", "商家B: 鍵盤 NT$2,500 (12%)", "各自獨立拆帳"], color: "border-blue-300 hover:border-blue-500", category: "結算" },
  // 嗨幣
  { id: "hi_coin_platform", title: "3. 嗨幣（平台補貼 Mode A）", description: "嗨幣折抵由平台吸收，商家收全額", details: ["藍芽音箱 NT$1,900", "消費者: 1,700台幣 + 200嗨幣", "平台補貼 200 給商家", "抽成依原價 1,900 計算"], color: "border-amber-300 hover:border-amber-500", category: "嗨幣" },
  { id: "hi_coin_merchant", title: "4. 嗨幣（商家活動 Mode B）", description: "嗨幣活動成本由商家負擔", details: ["智慧手錶 NT$3,000", "嗨幣折抵 500（商家承擔）", "從商家淨額扣除嗨幣活動成本"], color: "border-amber-400 hover:border-amber-600", category: "嗨幣" },
  // 費用
  { id: "merchant_campaign", title: "5. 商家活動成本", description: "商家參加平台活動，成本自行吸收", details: ["運動耳機 NT$1,200", "活動折扣 NT$150 由商家承擔", "從商家淨額中扣除"], color: "border-orange-300 hover:border-orange-500", category: "費用" },
  { id: "full_breakdown", title: "6. 複合訂單（全拆解展示）", description: "含所有費用類型的完整訂單", details: ["降噪耳機 NT$5,000 + 運費100", "抽成12% + 金流費2.8%", "嗨幣300(平台補貼) + 活動成本200", "展示完整公式拆解"], color: "border-indigo-300 hover:border-indigo-500", category: "費用" },
  // 退款
  { id: "partial_refund", title: "7. 部分退款", description: "兩件商品退一件，抽成按比例退", details: ["充電線A NT$300 + B NT$500", "退充電線A", "抽成退、金流費不退"], color: "border-orange-300 hover:border-orange-500", category: "退款" },
  { id: "full_refund", title: "8. 全額退款", description: "全額退款，抽成退金流費不退", details: ["螢幕保護貼 NT$600", "全額退款", "抽成退還、金流費不退"], color: "border-red-300 hover:border-red-500", category: "退款" },
  { id: "hi_coin_refund", title: "9. 嗨幣退款（原路返回）", description: "台幣退台幣、嗨幣退嗨幣", details: ["需先執行嗨幣場景", "退消費者台幣+嗨幣", "平台收回嗨幣補貼"], color: "border-amber-400 hover:border-amber-600", category: "退款" },
  // 爭議
  { id: "dispute_freeze", title: "10. 爭議凍結", description: "僅凍結爭議金額，非全單", details: ["行動電源 NT$1,200", "爭議 NT$500", "僅凍結 500"], color: "border-purple-300 hover:border-purple-500", category: "爭議" },
  { id: "dispute_resolve", title: "11. 爭議解除（商家勝）", description: "凍結金額退回 Available", details: ["需先執行爭議凍結", "商家勝訴", "解凍回可用"], color: "border-green-300 hover:border-green-500", category: "爭議" },
  { id: "dispute_reject", title: "12. 爭議扣回（商家敗）", description: "凍結金額永久扣除", details: ["自動建爭議+凍結", "商家敗訴", "永久扣回"], color: "border-red-300 hover:border-red-500", category: "爭議" },
  // 提領
  { id: "payout_success", title: "13. 提領成功", description: "申請→銀行成功", details: ["先結算一筆", "申請提領", "銀行成功"], color: "border-green-300 hover:border-green-500", category: "提領" },
  { id: "payout_failure", title: "14. 提領失敗退回", description: "失敗自動退回 wallet", details: ["先結算一筆", "申請提領", "失敗→退回"], color: "border-red-300 hover:border-red-500", category: "提領" },
  { id: "negative_balance", title: "15. 已提領後退款（負餘額）", description: "提領後退款，暫停提領", details: ["藍芽喇叭 NT$2,000", "提領後退款", "負餘額+暫停"], color: "border-red-400 hover:border-red-600", category: "提領" },
  // 其他
  { id: "reserve_release", title: "16. Reserve Hold/Release", description: "商家B Reserve 扣留後釋放", details: ["商家B 中風險", "結算扣 Reserve", "手動釋放"], color: "border-blue-300 hover:border-blue-500", category: "其他" },
  { id: "manual_adjustment", title: "17. 手動調整", description: "補發 +500 / 扣回 -200", details: ["Credit + Debit", "淨增 NT$300"], color: "border-indigo-300 hover:border-indigo-500", category: "其他" },
  { id: "bank_change", title: "18. 銀行帳號變更", description: "申請→審核→生效", details: ["申請", "審核", "生效"], color: "border-yellow-300 hover:border-yellow-500", category: "其他" },
  { id: "monthly_statement", title: "19. 月度對帳單", description: "產生當月正式對帳單", details: ["彙總 ledger", "期初/期末餘額", "可下載 XLSX"], color: "border-teal-300 hover:border-teal-500", category: "其他" },
  { id: "idempotency_test", title: "20. Webhook 冪等", description: "同一筆付款送兩次不重複", details: ["同 idempotencyKey", "驗證冪等性"], color: "border-gray-300 hover:border-gray-500", category: "其他" },
];

const CATEGORIES = ["結算", "嗨幣", "費用", "退款", "爭議", "提領", "其他"];
type CardState = "idle" | "loading" | "success" | "error";

export default function SimulatorPage() {
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState(false);

  async function run(id: string) {
    setStates((s) => ({ ...s, [id]: "loading" }));
    setMessages((m) => ({ ...m, [id]: "" }));
    try {
      const res = await fetch("/api/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: id }) });
      const data = await res.json();
      setStates((s) => ({ ...s, [id]: data.success ? "success" : "error" }));
      setMessages((m) => ({ ...m, [id]: data.message || "失敗" }));
    } catch {
      setStates((s) => ({ ...s, [id]: "error" }));
      setMessages((m) => ({ ...m, [id]: "網路錯誤" }));
    }
  }

  async function handleReset() {
    if (!confirm("確定清除所有模擬資料？")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: "reset" }) });
      const data = await res.json();
      if (data.success) { setStates({}); setMessages({}); alert(data.message); }
    } catch { alert("重置失敗"); }
    setResetting(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/login" className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50">
              <ArrowLeft className="inline h-4 w-4 mr-1" />返回
            </Link>
            <div>
              <h1 className="text-2xl font-bold">POC 場景模擬器 <span className="text-sm font-normal text-gray-400">PRD v1.1</span></h1>
              <p className="text-sm text-gray-500">21 個場景，覆蓋 PRD v1.1 全部 17 項驗收標準</p>
            </div>
          </div>
          <button onClick={handleReset} disabled={resetting} className="flex items-center gap-2 rounded-md border-2 border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
            {resetting ? "重置中..." : "清除全部資料"}
          </button>
        </div>

        {CATEGORIES.map((cat) => {
          const items = SCENARIOS.filter((s) => s.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-wider">{cat}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((sc) => {
                  const st = states[sc.id] || "idle";
                  const msg = messages[sc.id];
                  return (
                    <button key={sc.id} onClick={() => run(sc.id)} disabled={st === "loading"}
                      className={`relative rounded-xl border-2 bg-white p-5 text-left transition-all hover:shadow-md disabled:cursor-wait ${sc.color} ${st === "success" ? "border-green-500 bg-green-50" : ""} ${st === "error" ? "border-red-500 bg-red-50" : ""}`}>
                      <div className="absolute right-3 top-3">
                        {st === "loading" && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                        {st === "success" && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {st === "error" && <XCircle className="h-5 w-5 text-red-500" />}
                      </div>
                      <h3 className="font-semibold pr-8">{sc.title}</h3>
                      <p className="mt-1 text-sm text-gray-600">{sc.description}</p>
                      <ul className="mt-3 space-y-1">
                        {sc.details.map((d, i) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1"><span className="mt-0.5">{"•"}</span><span>{d}</span></li>
                        ))}
                      </ul>
                      {msg && (
                        <div className={`mt-3 rounded-md p-2 text-xs whitespace-pre-wrap ${st === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{msg}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

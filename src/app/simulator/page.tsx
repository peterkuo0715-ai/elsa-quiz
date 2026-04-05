"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Scenario {
  id: string;
  title: string;
  description: string;
  details: string[];
  color: string;
  category: string;
}

const SCENARIOS: Scenario[] = [
  // Settlement
  {
    id: "pending_appreciation",
    title: "0. 鑑賞期中 (未結算)",
    description: "商家A 一件商品，已到貨但鑑賞期 7 天未過，款項在 Pending 中",
    details: ["無線充電盤 NT$1,800", "已付款 → 已出貨 → 已到貨", "鑑賞期中，尚不可提領"],
    color: "border-yellow-300 hover:border-yellow-500",
    category: "結算",
  },
  {
    id: "normal_settlement",
    title: "1. 正常結算 (單商家)",
    description: "商家A 一件商品，走完付款 → 出貨 → 到貨 → 鑑賞期 → 結算入帳",
    details: ["藍芽耳機 NT$1,500", "抽成 10%", "結算後入帳至 Available"],
    color: "border-green-300 hover:border-green-500",
    category: "結算",
  },
  {
    id: "multi_merchant",
    title: "2. 多商家訂單拆分",
    description: "一張訂單包含商家A+B商品，自動拆分各自結算",
    details: ["商家A: 無線滑鼠 NT$800 (10%)", "商家B: 機械鍵盤 NT$2,500 (12%)", "各自獨立入帳"],
    color: "border-blue-300 hover:border-blue-500",
    category: "結算",
  },

  // Refund
  {
    id: "partial_refund",
    title: "3. 部分退款",
    description: "商家A 兩件商品結算後，退其中一件",
    details: ["充電線A NT$300 + 充電線B NT$500", "退充電線A", "抽成按比例退、金流費不退"],
    color: "border-orange-300 hover:border-orange-500",
    category: "退款",
  },
  {
    id: "full_refund",
    title: "4. 全額退款",
    description: "商家A 一件商品結算後，全額退款",
    details: ["螢幕保護貼 NT$600", "全額退款扣回", "抽成按比例退"],
    color: "border-red-300 hover:border-red-500",
    category: "退款",
  },

  // Dispute
  {
    id: "dispute_freeze",
    title: "5. 爭議凍結",
    description: "建立爭議案件，僅凍結爭議金額 (非全單)",
    details: ["行動電源 NT$1,200 結算", "爭議金額 NT$500", "僅凍結 500，非 1200"],
    color: "border-purple-300 hover:border-purple-500",
    category: "爭議",
  },
  {
    id: "dispute_resolve",
    title: "6. 爭議解除 (商家勝)",
    description: "凍結金額退回 Available",
    details: ["需先執行「爭議凍結」", "商家勝訴", "凍結金額解凍回可用"],
    color: "border-green-300 hover:border-green-500",
    category: "爭議",
  },
  {
    id: "dispute_reject",
    title: "7. 爭議扣回 (商家敗)",
    description: "凍結金額永久從 Reserved 扣回",
    details: ["自動建立爭議+凍結", "商家敗訴", "金額從 Reserved 永久扣除"],
    color: "border-red-300 hover:border-red-500",
    category: "爭議",
  },

  // Payout
  {
    id: "payout_success",
    title: "8. 提領成功",
    description: "商家申請提領 → 批次處理 → 銀行匯款成功",
    details: ["先結算一筆訂單", "申請提領全額", "銀行處理成功，IN_TRANSIT 清零"],
    color: "border-green-300 hover:border-green-500",
    category: "提領",
  },
  {
    id: "payout_failure",
    title: "9. 提領失敗退回",
    description: "提領失敗，金額自動從 IN_TRANSIT 退回 AVAILABLE",
    details: ["先結算一筆訂單", "申請提領", "銀行回報失敗 → 自動退回 wallet"],
    color: "border-red-300 hover:border-red-500",
    category: "提領",
  },
  {
    id: "negative_balance",
    title: "10. 已提領後退款 (負餘額)",
    description: "提領成功後才退款，形成負餘額，暫停提領",
    details: ["藍芽喇叭 NT$2,000 → 結算 → 提領", "提領後全額退款", "Available 變負數，提領暫停"],
    color: "border-red-400 hover:border-red-600",
    category: "提領",
  },

  // Hi Coin
  {
    id: "hi_coin_payment",
    title: "14. 嗨幣結帳",
    description: "消費者用台幣+嗨幣混合支付，平台補貼嗨幣給商家",
    details: ["藍芽音箱 NT$1,900", "消費者付 1,700台幣 + 200嗨幣", "抽成依原價 1,900 計算", "平台補貼 200 嗨幣給商家"],
    color: "border-amber-300 hover:border-amber-500",
    category: "嗨幣",
  },
  {
    id: "hi_coin_refund",
    title: "15. 嗨幣退款（原路返回）",
    description: "嗨幣訂單全額退款，台幣退台幣、嗨幣退嗨幣",
    details: ["需先執行「嗨幣結帳」", "退消費者 1,700台幣 + 200嗨幣", "平台收回 200 嗨幣補貼", "抽成退還商家"],
    color: "border-amber-400 hover:border-amber-600",
    category: "嗨幣",
  },

  // Reserve
  {
    id: "reserve_release",
    title: "16. Reserve Hold / Release",
    description: "商家B 結算時自動扣 Reserve，然後手動釋放",
    details: ["商家B (中風險) 有 Reserve 規則", "結算時自動扣留", "手動釋放回 Available"],
    color: "border-blue-300 hover:border-blue-500",
    category: "Reserve",
  },

  // Adjustment
  {
    id: "manual_adjustment",
    title: "17. 手動調整 Credit / Debit",
    description: "平台財務建立補發 + 扣回調整單",
    details: ["補發 NT$500 (Credit)", "扣回 NT$200 (Debit)", "淨增 NT$300，留稽核紀錄"],
    color: "border-indigo-300 hover:border-indigo-500",
    category: "調整",
  },

  // Bank Change
  {
    id: "bank_change",
    title: "18. 銀行帳號變更",
    description: "商家申請帳號變更 → 平台審核通過 → 生效",
    details: ["申請變更至台新銀行", "平台財務審核", "核准後新帳號立即生效"],
    color: "border-yellow-300 hover:border-yellow-500",
    category: "帳號",
  },

  // Idempotency
  {
    id: "idempotency_test",
    title: "19. Webhook 重送 (冪等測試)",
    description: "同一筆付款 webhook 送兩次，驗證不會重複建單",
    details: ["同一個 idempotencyKey 送兩次", "第二次回傳與第一次相同結果", "驗證系統冪等性"],
    color: "border-gray-300 hover:border-gray-500",
    category: "系統",
  },
];

const CATEGORIES = ["結算", "退款", "爭議", "提領", "嗨幣", "Reserve", "調整", "帳號", "系統"];

type CardState = "idle" | "loading" | "success" | "error";

export default function SimulatorPage() {
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState(false);

  async function runScenario(id: string) {
    setStates((s) => ({ ...s, [id]: "loading" }));
    setMessages((m) => ({ ...m, [id]: "" }));

    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: id }),
      });
      const data = await res.json();

      if (data.success) {
        setStates((s) => ({ ...s, [id]: "success" }));
        setMessages((m) => ({ ...m, [id]: data.message }));
      } else {
        setStates((s) => ({ ...s, [id]: "error" }));
        setMessages((m) => ({ ...m, [id]: data.message || "執行失敗" }));
      }
    } catch {
      setStates((s) => ({ ...s, [id]: "error" }));
      setMessages((m) => ({ ...m, [id]: "網路錯誤" }));
    }
  }

  async function handleReset() {
    if (!confirm("確定要清除所有模擬資料嗎？")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "reset" }),
      });
      const data = await res.json();
      if (data.success) {
        setStates({});
        setMessages({});
        alert(data.message);
      }
    } catch {
      alert("重置失敗");
    }
    setResetting(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/login" className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50">
              <ArrowLeft className="inline h-4 w-4 mr-1" />
              返回登入
            </Link>
            <div>
              <h1 className="text-2xl font-bold">POC 場景模擬器</h1>
              <p className="text-sm text-gray-500">
                點擊方塊一鍵執行完整流程，展示系統所有帳務場景
              </p>
            </div>
          </div>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-2 rounded-md border-2 border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
            {resetting ? "重置中..." : "清除全部資料"}
          </button>
        </div>

        {/* Scenario Cards by Category */}
        {CATEGORIES.map((cat) => {
          const items = SCENARIOS.filter((s) => s.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-wider">
                {cat}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((scenario) => {
                  const state = states[scenario.id] || "idle";
                  const message = messages[scenario.id];

                  return (
                    <button
                      key={scenario.id}
                      onClick={() => runScenario(scenario.id)}
                      disabled={state === "loading"}
                      className={`relative rounded-xl border-2 bg-white p-5 text-left transition-all hover:shadow-md disabled:cursor-wait ${scenario.color} ${
                        state === "success" ? "border-green-500 bg-green-50" : ""
                      } ${state === "error" ? "border-red-500 bg-red-50" : ""}`}
                    >
                      {/* Status icon */}
                      <div className="absolute right-3 top-3">
                        {state === "loading" && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                        {state === "success" && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {state === "error" && <XCircle className="h-5 w-5 text-red-500" />}
                      </div>

                      <h3 className="font-semibold pr-8">{scenario.title}</h3>
                      <p className="mt-1 text-sm text-gray-600">{scenario.description}</p>

                      <ul className="mt-3 space-y-1">
                        {scenario.details.map((d, i) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                            <span className="mt-0.5">{"•"}</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Result message */}
                      {message && (
                        <div className={`mt-3 rounded-md p-2 text-xs ${
                          state === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}>
                          {message}
                        </div>
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

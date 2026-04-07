"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Loader2, Wallet, Coins, Gift, Users, ShoppingBag } from "lucide-react";

interface Account { hiCoin: number; }

const INITIAL_REFERRER: Account = { hiCoin: 0 };
const INITIAL_LIST_CREATOR: Account = { hiCoin: 0 };

type Scenario = "referral_settled" | "referral_refund" | "list_guide_settled" | "list_guide_refund";

const SCENARIOS: Array<{ id: Scenario; label: string; desc: string; color: string; category: string }> = [
  { id: "referral_settled", label: "推薦碼 — 正常完成", desc: "推薦碼購買，鑑賞期後推薦人獲得獎勵", color: "border-green-300 hover:border-green-500", category: "推薦碼" },
  { id: "referral_refund", label: "推薦碼 — 退款", desc: "推薦碼購買後全額退款，獎勵取消", color: "border-red-300 hover:border-red-500", category: "推薦碼" },
  { id: "list_guide_settled", label: "清單導購 — 正常完成", desc: "清單導購購買，鑑賞期後建立者獲得獎勵", color: "border-green-300 hover:border-green-500", category: "清單導購" },
  { id: "list_guide_refund", label: "清單導購 — 退款", desc: "清單導購購買後全額退款，獎勵取消", color: "border-red-300 hover:border-red-500", category: "清單導購" },
];

const CATEGORIES = ["推薦碼", "清單導購"];

export default function RewardsSimulatorPage() {
  const [referrer, setReferrer] = useState<Account>({ ...INITIAL_REFERRER });
  const [listCreator, setListCreator] = useState<Account>({ ...INITIAL_LIST_CREATOR });
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ id: string; message: string; success: boolean }>>([]);

  async function runScenario(id: Scenario) {
    setLoading(id);
    // Simulate reward flow
    await new Promise((r) => setTimeout(r, 800));

    let message = "";
    let success = true;

    switch (id) {
      case "referral_settled": {
        const reward = 50; // per item
        const items = 1;
        const total = reward * items;
        setReferrer((r) => ({ hiCoin: r.hiCoin + total }));
        message = `✅ 推薦碼正常完成\n\n訂單: 藍芽耳機 NT$1,350 (推薦碼價)\n推薦人獎勵: ${total} 嗨幣 (${reward}/件 × ${items}件)\n\n流程:\n1. 消費者使用推薦碼結帳\n2. 訂單進入鑑賞期（獎勵為預計值）\n3. 鑑賞期結束，確認訂單成立\n4. 推薦人帳戶 +${total} 嗨幣\n\n商家承擔: ${total} 嗨幣（從商家應得扣除）\n推薦人帳戶: ${referrer.hiCoin + total} 嗨幣`;
        break;
      }
      case "referral_refund": {
        message = `🔄 推薦碼退款\n\n訂單: 藍芽耳機 NT$1,350 (推薦碼價) → 全額退款\n推薦人獎勵: 0 嗨幣（退款後歸零）\n\n流程:\n1. 消費者使用推薦碼結帳\n2. 鑑賞期中/後發生退款\n3. 獎勵預計值作廢\n4. 推薦人不獲得任何嗨幣\n\nPRD v3 規則: 「不採先發後追回」\n→ 鑑賞期前僅記錄預計值\n→ 退款後依最終成立交易重算\n→ 全退 = 獎勵歸零`;
        break;
      }
      case "list_guide_settled": {
        const reward = 80; // per item
        const items = 1;
        const total = reward * items;
        setListCreator((r) => ({ hiCoin: r.hiCoin + total }));
        message = `✅ 清單導購正常完成\n\n訂單: 藍芽耳機 NT$1,400 (VIP價，不變)\n清單建立者獎勵: ${total} 嗨幣\n  = (買家等級價差 50) + (推廣價格X 30) = ${total}\n\n流程:\n1. 消費者從清單加入購物車（歸因鎖定）\n2. 消費者結帳（價格不變）\n3. 鑑賞期結束，確認訂單成立\n4. 清單建立者帳戶 +${total} 嗨幣\n\n商家承擔: ${total} 嗨幣（從商家應得扣除）\n清單建立者帳戶: ${listCreator.hiCoin + total} 嗨幣`;
        break;
      }
      case "list_guide_refund": {
        message = `🔄 清單導購退款\n\n訂單: 藍芽耳機 NT$1,400 → 全額退款\n清單建立者獎勵: 0 嗨幣（退款後歸零）\n\n流程:\n1. 消費者從清單購買\n2. 退款發生\n3. 獎勵預計值作廢\n4. 清單建立者不獲得嗨幣\n\nPRD v3 規則: 同推薦碼\n→ 鑑賞期前僅記錄預計值\n→ 退款後依最終成立交易重算`;
        break;
      }
    }

    setResults((prev) => [{ id, message, success }, ...prev]);
    setLoading(null);
  }

  function handleReset() {
    setReferrer({ ...INITIAL_REFERRER });
    setListCreator({ ...INITIAL_LIST_CREATOR });
    setResults([]);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/simulator" className="text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="inline h-4 w-4" /> 返回主模擬器</Link>
            <h1 className="text-lg font-bold">導購獎勵模擬器 <span className="text-sm font-normal text-green-600">PRD v3</span></h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Referrer account */}
            <div className="flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-2">
              <Users className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-medium">推薦人</span>
              <Coins className="h-3 w-3 text-amber-500" />
              <span className="font-mono text-sm"><strong className="text-purple-700">{referrer.hiCoin}</strong> 嗨幣</span>
            </div>
            {/* List creator account */}
            <div className="flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2">
              <ShoppingBag className="h-4 w-4 text-teal-600" />
              <span className="text-xs font-medium">清單建立者</span>
              <Coins className="h-3 w-3 text-amber-500" />
              <span className="font-mono text-sm"><strong className="text-teal-700">{listCreator.hiCoin}</strong> 嗨幣</span>
            </div>
            <button onClick={handleReset} className="flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
              <RotateCcw className="h-3 w-3" /> 重置
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {/* Info */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="font-semibold text-blue-800 flex items-center gap-2"><Gift className="h-4 w-4" /> PRD v3 導購獎勵規則</h3>
          <div className="mt-2 grid gap-4 md:grid-cols-2 text-sm text-blue-700">
            <div>
              <p className="font-medium">推薦碼</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>{"•"} 商家出資的商品級優惠（折扣10%）</li>
                <li>{"•"} 與 VIP 同層擇一，不可疊加</li>
                <li>{"•"} 推薦人獎勵：50 嗨幣/件（商家承擔）</li>
                <li>{"•"} 鑑賞期後才發放，退款則歸零</li>
              </ul>
            </div>
            <div>
              <p className="font-medium">清單導購</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>{"•"} 不改變消費者前台成交價</li>
                <li>{"•"} 清單建立者獎勵：等級價差 + 推廣價格 X</li>
                <li>{"•"} 獎勵由商家承擔，從商家應得扣除</li>
                <li>{"•"} 同一商品僅歸因一種導購來源</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Scenarios */}
        {CATEGORIES.map((cat) => {
          const items = SCENARIOS.filter((s) => s.category === cat);
          return (
            <div key={cat}>
              <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase">{cat}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((sc) => {
                  const isLoading = loading === sc.id;
                  const result = results.find((r) => r.id === sc.id);
                  return (
                    <button key={sc.id} onClick={() => runScenario(sc.id)} disabled={isLoading}
                      className={`rounded-xl border-2 bg-white p-5 text-left transition-all hover:shadow-md disabled:cursor-wait ${sc.color}`}>
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">{sc.label}</h3>
                        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{sc.desc}</p>
                      {result && (
                        <div className={`mt-3 rounded-md p-3 text-xs whitespace-pre-wrap ${result.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                          {result.message}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Link back */}
        <div className="text-center pt-4">
          <Link href="/simulator" className="text-sm text-blue-600 hover:underline">← 返回主模擬器（訂單結算 POC）</Link>
        </div>
      </div>
    </div>
  );
}

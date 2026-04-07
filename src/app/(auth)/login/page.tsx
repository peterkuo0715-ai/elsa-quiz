"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, Calculator, Store } from "lucide-react";

const ACCOUNTS = [
  {
    role: "超級管理員",
    email: "admin@hi5.com",
    description: "覆寫狀態、凍結錢包、代理登入",
    icon: ShieldAlert,
    color: "border-red-200 hover:border-red-400 hover:bg-red-50",
  },
  {
    role: "平台財務",
    email: "finance@hi5.com",
    description: "結算批次、提領管理、調整單、Reserve",
    icon: Calculator,
    color: "border-blue-200 hover:border-blue-400 hover:bg-blue-50",
  },
  {
    role: "商家 A",
    email: "owner@merchant-a.com",
    description: "測試商家 A - 查看帳務、提領、爭議",
    icon: Store,
    color: "border-green-200 hover:border-green-400 hover:bg-green-50",
  },
  {
    role: "商家 B",
    email: "owner@merchant-b.com",
    description: "測試商家 B - 查看帳務、提領、爭議",
    icon: Store,
    color: "border-purple-200 hover:border-purple-400 hover:bg-purple-50",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleLogin(email: string) {
    setError("");
    setLoading(email);

    const result = await signIn("credentials", {
      email,
      password: "skip",
      redirect: false,
    });

    setLoading(null);

    if (result?.error) {
      setError("登入失敗，請稍後再試");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">商家對帳系統</CardTitle>
          <p className="text-sm text-muted-foreground">
            選擇角色直接登入
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              onClick={() => handleLogin(acc.email)}
              disabled={loading !== null}
              className={`flex w-full items-center gap-4 rounded-lg border-2 p-4 text-left transition-all ${acc.color} ${loading === acc.email ? "opacity-60" : ""} disabled:cursor-wait`}
            >
              <acc.icon className="h-8 w-8 shrink-0 text-gray-500" />
              <div className="flex-1">
                <p className="font-semibold">{acc.role}</p>
                <p className="text-sm text-muted-foreground">{acc.description}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{acc.email}</p>
              </div>
              {loading === acc.email && (
                <span className="text-sm text-muted-foreground">登入中...</span>
              )}
            </button>
          ))}

          {error && (
            <p className="text-center text-sm text-red-500">{error}</p>
          )}

          <div className="pt-4 border-t text-center space-y-2">
            <a href="/simulator"
              className="inline-flex items-center gap-2 rounded-md border-2 border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-gray-500 hover:text-gray-700 transition-colors">
              POC 場景模擬器
            </a>
            <br />
            <a href="/simulator-rewards"
              className="inline-flex items-center gap-2 rounded-md border-2 border-dashed border-purple-300 px-4 py-2 text-sm text-purple-500 hover:border-purple-500 hover:text-purple-700 transition-colors">
              🎁 導購獎勵模擬器
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

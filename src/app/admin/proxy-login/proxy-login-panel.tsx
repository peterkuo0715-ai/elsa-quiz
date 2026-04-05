"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserCog, ExternalLink } from "lucide-react";

interface Merchant {
  id: string;
  name: string;
  users: Array<{ id: string; name: string; email: string }>;
}

export function ProxyLoginPanel({ merchants }: { merchants: Merchant[] }) {
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);

  // In production, this would use a special token-based proxy login mechanism.
  // For MVP, we show the merchant accounts and provide a link to login page.
  function handleProxyLogin(email: string) {
    // In real implementation: generate a temporary proxy token,
    // set it in session, and redirect to merchant dashboard.
    // For now, open a new tab with login hint.
    window.open(`/login?proxy=true&email=${encodeURIComponent(email)}`, "_blank");
  }

  if (merchants.length === 0) {
    return <p className="text-sm text-muted-foreground">無商家資料</p>;
  }

  return (
    <div className="space-y-3">
      {merchants.map((m) => (
        <div key={m.id} className="rounded-md border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">
                {m.users.length} 個帳號
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedMerchant(
                  selectedMerchant === m.id ? null : m.id
                )
              }
            >
              <UserCog className="mr-1 h-3 w-3" />
              {selectedMerchant === m.id ? "收合" : "展開帳號"}
            </Button>
          </div>

          {selectedMerchant === m.id && (
            <div className="mt-3 space-y-2">
              {m.users.length === 0 ? (
                <p className="text-xs text-muted-foreground">此商家無帳號</p>
              ) : (
                m.users.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded border p-2"
                  >
                    <div className="text-sm">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleProxyLogin(u.email)}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      代理登入
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

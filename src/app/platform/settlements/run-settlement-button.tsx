"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";

export function RunSettlementButton({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleRun() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/cron/settle", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ""}` },
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`結算完成: ${data.successCount} 成功, ${data.failedCount} 失敗`);
      } else {
        setMessage(data.error || "結算失敗");
      }
    } catch {
      setMessage("結算失敗");
    }
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleRun} disabled={loading || pendingCount === 0} className="w-full">
        <Calculator className="mr-1 h-4 w-4" />
        {loading ? "結算中..." : pendingCount > 0 ? `執行結算 (${pendingCount} 筆)` : "無待結算項目"}
      </Button>
      {message && (
        <p className={`text-sm ${message.includes("完成") ? "text-green-600" : "text-red-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

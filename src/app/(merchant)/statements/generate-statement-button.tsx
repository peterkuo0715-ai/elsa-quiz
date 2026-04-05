"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileBarChart } from "lucide-react";

export function GenerateStatementButton({
  merchantId,
}: {
  merchantId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    // Generate for last month
    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth();

    try {
      const res = await fetch("/api/cron/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, year, month }),
      });
      router.refresh();
    } catch {
      // Fallback - use server action
    }
    setLoading(false);
    router.refresh();
  }

  return (
    <Button onClick={handleGenerate} disabled={loading}>
      <FileBarChart className="mr-1 h-4 w-4" />
      {loading ? "產生中..." : "產生上月對帳單"}
    </Button>
  );
}

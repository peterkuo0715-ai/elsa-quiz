"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createPayoutBatch } from "@/server/actions/payout-batch.actions";

export function CreateBatchButton({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleCreate() {
    setLoading(true);
    setMessage("");
    const result = await createPayoutBatch();
    setLoading(false);

    if (result.error) {
      setMessage(result.error);
    } else if (result.success) {
      setMessage(
        `批次 ${result.batchNumber} 已建立，包含 ${result.itemCount} 筆`
      );
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleCreate}
        disabled={loading || pendingCount === 0}
        className="w-full"
      >
        {loading
          ? "建立中..."
          : pendingCount > 0
            ? `建立批次 (${pendingCount} 筆)`
            : "無待處理項目"}
      </Button>
      {message && (
        <p className={`text-sm ${message.includes("已建立") ? "text-green-600" : "text-red-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitDisputeEvidence } from "@/server/actions/dispute.actions";

export function DisputeEvidenceForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        補件
      </Button>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    const formData = new FormData();
    formData.set("disputeId", disputeId);
    formData.set("description", description);
    const result = await submitDisputeEvidence(formData);
    setLoading(false);

    if (result.success) {
      setOpen(false);
      setDescription("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="請提供爭議說明或證據..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="text-sm"
      />
      <div className="flex gap-1">
        <Button size="sm" onClick={handleSubmit} disabled={loading || !description}>
          {loading ? "..." : "送出"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </div>
  );
}

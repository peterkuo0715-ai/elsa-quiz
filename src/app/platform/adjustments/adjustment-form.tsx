"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdjustment } from "@/server/actions/adjustment.actions";

const ADJUSTMENT_TYPES = [
  { value: "SUPPLEMENTARY_PAYMENT", label: "補發" },
  { value: "CLAWBACK", label: "扣回" },
  { value: "COMPLAINT_COMPENSATION", label: "客訴補償" },
  { value: "DISCREPANCY_CORRECTION", label: "帳差修正" },
  { value: "TAX_ADJUSTMENT", label: "稅務調整" },
  { value: "SYSTEM_CORRECTION", label: "系統修正" },
];

interface Props {
  merchants: Array<{ id: string; name: string }>;
}

export function AdjustmentForm({ merchants }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await createAdjustment(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess("調整單已建立");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">商家</Label>
          <select
            name="merchantId"
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">選擇商家</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">調整類型</Label>
          <select
            name="adjustmentType"
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">選擇類型</option>
            {ADJUSTMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">方向</Label>
          <select
            name="direction"
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="credit">貸方（補發給商家）</option>
            <option value="debit">借方（從商家扣回）</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">金額（含稅）</Label>
          <Input name="amount" type="number" step="1" min="1" required placeholder="輸入金額" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">原因說明</Label>
        <Textarea name="reason" required placeholder="請詳細說明調整原因" rows={3} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <Button type="submit" disabled={loading}>
        {loading ? "建立中..." : "建立調整單"}
      </Button>
    </form>
  );
}

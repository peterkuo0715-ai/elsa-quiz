"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestPayout } from "@/server/actions/payout.actions";
import { moneyFormat } from "@/lib/money";

interface Props {
  availableBalance: string;
  bankAccounts: Array<{ id: string; label: string }>;
}

export function PayoutRequestForm({ availableBalance, bankAccounts }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const formData = new FormData();
    formData.set("amount", amount);
    formData.set("bankAccountId", bankAccountId);

    const result = await requestPayout(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (result.success) {
      setSuccess(`提領申請成功！編號: ${result.requestNumber}`);
      setAmount("");
      router.refresh();
    }
  }

  function setFullAmount() {
    setAmount(availableBalance);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">提領金額</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            step="1"
            min="1"
            placeholder="輸入金額"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <Button type="button" variant="outline" size="sm" onClick={setFullAmount}>
            全額
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          可提領: {moneyFormat(availableBalance)}
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">匯入帳號</Label>
        <Select value={bankAccountId} onValueChange={(v) => setBankAccountId(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="選擇銀行帳號" />
          </SelectTrigger>
          <SelectContent>
            {bankAccounts.map((ba) => (
              <SelectItem key={ba.id} value={ba.id}>
                {ba.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <Button type="submit" className="w-full" disabled={loading || !bankAccountId}>
        {loading ? "處理中..." : "送出提領申請"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestBankAccountChange } from "@/server/actions/bank-account.actions";

export function BankAccountChangeForm() {
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
    const result = await requestBankAccountChange(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess("變更申請已送出，請等待平台財務審核");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">銀行代碼</Label>
          <Input name="bankCode" placeholder="例: 004" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">銀行名稱</Label>
          <Input name="bankName" placeholder="例: 台灣銀行" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">分行代碼</Label>
          <Input name="branchCode" placeholder="例: 0012" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">分行名稱</Label>
          <Input name="branchName" placeholder="例: 信義分行" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">帳號</Label>
          <Input name="accountNumber" placeholder="銀行帳號" required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">戶名</Label>
          <Input name="accountName" placeholder="帳戶名稱" required />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <Button type="submit" disabled={loading}>
        {loading ? "送出中..." : "送出變更申請"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveBankAccountChange,
  rejectBankAccountChange,
} from "@/server/actions/bank-account.actions";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

interface Request {
  id: string;
  bankCode: string;
  bankName: string;
  branchCode: string | null;
  branchName: string | null;
  accountNumber: string;
  accountName: string;
  requestedAt: Date | string;
  merchant: { id: string; name: string; taxId: string | null };
}

export function BankApprovalList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  async function handleApprove(id: string) {
    setLoadingId(id);
    const result = await approveBankAccountChange(id);
    setLoadingId(null);
    if (result.success) router.refresh();
  }

  async function handleReject(id: string) {
    const reason = rejectReasons[id];
    if (!reason) return;
    setLoadingId(id);
    const result = await rejectBankAccountChange(id, reason);
    setLoadingId(null);
    if (result.success) router.refresh();
  }

  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        目前無待審核申請
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {requests.map((req) => (
        <div key={req.id} className="rounded-md border p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium">{req.merchant.name}</p>
              <p className="text-xs text-muted-foreground">
                統編: {req.merchant.taxId || "-"} | 申請時間:{" "}
                {format(new Date(req.requestedAt), "yyyy/MM/dd HH:mm", {
                  locale: zhTW,
                })}
              </p>
            </div>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">銀行: </span>
              {req.bankName} ({req.bankCode})
            </div>
            <div>
              <span className="text-muted-foreground">分行: </span>
              {req.branchName || "-"} ({req.branchCode || "-"})
            </div>
            <div>
              <span className="text-muted-foreground">帳號: </span>
              {req.accountNumber}
            </div>
            <div>
              <span className="text-muted-foreground">戶名: </span>
              {req.accountName}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => handleApprove(req.id)}
              disabled={loadingId === req.id}
            >
              核准
            </Button>
            <Input
              placeholder="拒絕原因"
              className="max-w-xs text-sm"
              value={rejectReasons[req.id] || ""}
              onChange={(e) =>
                setRejectReasons((prev) => ({
                  ...prev,
                  [req.id]: e.target.value,
                }))
              }
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleReject(req.id)}
              disabled={loadingId === req.id || !rejectReasons[req.id]}
            >
              拒絕
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

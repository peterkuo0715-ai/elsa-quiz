"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  toggleWalletFreeze,
  forceAdjustment,
} from "@/server/actions/admin.actions";
import { Lock, Unlock, AlertTriangle } from "lucide-react";

interface Merchant {
  id: string;
  name: string;
  isFrozen: boolean;
  frozenReason: string | null;
  payoutSuspended: boolean;
}

export function OverridePanel({ merchants }: { merchants: Merchant[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [adjustAmounts, setAdjustAmounts] = useState<Record<string, string>>({});
  const [adjustReasons, setAdjustReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function handleToggleFreeze(merchantId: string, freeze: boolean) {
    const reason = reasons[merchantId];
    if (freeze && !reason) {
      setMessage("請填寫凍結原因");
      return;
    }
    setLoadingId(merchantId);
    const result = await toggleWalletFreeze(merchantId, freeze, reason || "管理員解凍");
    setLoadingId(null);
    if (result.success) {
      setMessage(freeze ? "已凍結" : "已解凍");
      router.refresh();
    } else {
      setMessage(result.error || "操作失敗");
    }
  }

  async function handleForceAdjust(merchantId: string, isCredit: boolean) {
    const amount = adjustAmounts[merchantId];
    const reason = adjustReasons[merchantId];
    if (!amount || !reason) {
      setMessage("請填寫金額和原因");
      return;
    }
    setLoadingId(merchantId);
    const result = await forceAdjustment(merchantId, amount, isCredit, reason);
    setLoadingId(null);
    if (result.success) {
      setMessage("調整完成");
      setAdjustAmounts((prev) => ({ ...prev, [merchantId]: "" }));
      setAdjustReasons((prev) => ({ ...prev, [merchantId]: "" }));
      router.refresh();
    } else {
      setMessage(result.error || "操作失敗");
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-800">
          {message}
        </div>
      )}

      {merchants.map((m) => (
        <div key={m.id} className="rounded-md border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{m.name}</span>
              <div className="flex gap-2 mt-1">
                {m.isFrozen && (
                  <Badge className="bg-red-100 text-red-800 border-0">
                    <Lock className="mr-1 h-3 w-3" />
                    凍結中 {m.frozenReason && `- ${m.frozenReason}`}
                  </Badge>
                )}
                {m.payoutSuspended && (
                  <Badge className="bg-orange-100 text-orange-800 border-0">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    提領暫停
                  </Badge>
                )}
                {!m.isFrozen && !m.payoutSuspended && (
                  <Badge className="bg-green-100 text-green-800 border-0">正常</Badge>
                )}
              </div>
            </div>
          </div>

          {/* Freeze/Unfreeze */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="原因"
              value={reasons[m.id] || ""}
              onChange={(e) =>
                setReasons((prev) => ({ ...prev, [m.id]: e.target.value }))
              }
              className="h-8 max-w-xs text-sm"
            />
            {m.isFrozen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleToggleFreeze(m.id, false)}
                disabled={loadingId === m.id}
              >
                <Unlock className="mr-1 h-3 w-3" />
                解凍
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleToggleFreeze(m.id, true)}
                disabled={loadingId === m.id || !reasons[m.id]}
              >
                <Lock className="mr-1 h-3 w-3" />
                凍結
              </Button>
            )}
          </div>

          <Separator />

          {/* Force Adjustment */}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="金額"
              value={adjustAmounts[m.id] || ""}
              onChange={(e) =>
                setAdjustAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))
              }
              className="h-8 w-28 text-sm"
            />
            <Input
              placeholder="調整原因"
              value={adjustReasons[m.id] || ""}
              onChange={(e) =>
                setAdjustReasons((prev) => ({ ...prev, [m.id]: e.target.value }))
              }
              className="h-8 max-w-xs text-sm"
            />
            <Button
              size="sm"
              onClick={() => handleForceAdjust(m.id, true)}
              disabled={loadingId === m.id}
            >
              補發
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleForceAdjust(m.id, false)}
              disabled={loadingId === m.id}
            >
              扣回
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setMerchantRiskLevel,
  setReserveRule,
  releaseReserve,
} from "@/server/actions/reserve.actions";

interface Props {
  merchantId: string;
  merchantName: string;
  currentRiskLevel: string;
  currentReservePercent?: string;
  currentHoldDays?: number;
}

export function ReserveManagementPanel({
  merchantId,
  merchantName,
  currentRiskLevel,
  currentReservePercent,
  currentHoldDays,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [riskLevel, setRiskLevel] = useState(currentRiskLevel);
  const [reservePercent, setReservePercent] = useState(
    currentReservePercent
      ? (Number(currentReservePercent) * 100).toString()
      : ""
  );
  const [holdDays, setHoldDays] = useState(
    currentHoldDays?.toString() || "30"
  );
  const [releaseAmount, setReleaseAmount] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        設定
      </Button>
    );
  }

  async function handleSaveRisk() {
    setLoading(true);
    await setMerchantRiskLevel(
      merchantId,
      riskLevel as "LOW" | "MEDIUM" | "HIGH"
    );
    setLoading(false);
    router.refresh();
  }

  async function handleSaveRule() {
    setLoading(true);
    const percent = (Number(reservePercent) / 100).toFixed(4);
    await setReserveRule(merchantId, percent, parseInt(holdDays));
    setLoading(false);
    router.refresh();
  }

  async function handleRelease() {
    if (!releaseAmount) return;
    setLoading(true);
    const formData = new FormData();
    formData.set("merchantId", merchantId);
    formData.set("amount", releaseAmount);
    formData.set("reason", "手動釋放");
    await releaseReserve(formData);
    setLoading(false);
    setReleaseAmount("");
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded border p-3">
      <p className="text-xs font-medium">{merchantName}</p>

      <div className="flex items-center gap-2">
        <select
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value)}
          className="h-8 rounded border px-2 text-xs"
        >
          <option value="LOW">低風險</option>
          <option value="MEDIUM">中風險</option>
          <option value="HIGH">高風險</option>
        </select>
        <Button size="sm" onClick={handleSaveRisk} disabled={loading}>
          儲存等級
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="0.1"
          min="0"
          max="100"
          placeholder="Reserve %"
          value={reservePercent}
          onChange={(e) => setReservePercent(e.target.value)}
          className="h-8 w-24 text-xs"
        />
        <span className="text-xs">%</span>
        <Input
          type="number"
          min="1"
          placeholder="天數"
          value={holdDays}
          onChange={(e) => setHoldDays(e.target.value)}
          className="h-8 w-20 text-xs"
        />
        <span className="text-xs">天</span>
        <Button size="sm" onClick={handleSaveRule} disabled={loading}>
          儲存規則
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          placeholder="釋放金額"
          value={releaseAmount}
          onChange={(e) => setReleaseAmount(e.target.value)}
          className="h-8 w-32 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleRelease}
          disabled={loading || !releaseAmount}
        >
          釋放 Reserve
        </Button>
      </div>

      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        收合
      </Button>
    </div>
  );
}

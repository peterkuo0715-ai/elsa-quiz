"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  freezeDisputeAmount,
  resolveDispute,
  rejectDispute,
} from "@/server/actions/dispute.actions";

interface Props {
  disputeId: string;
  status: string;
  hasFrozen: boolean;
}

export function PlatformDisputeActions({ disputeId, status, hasFrozen }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [resolution, setResolution] = useState("");

  const canFreeze =
    !hasFrozen &&
    ["OPENED", "WAITING_MERCHANT_RESPONSE", "EVIDENCE_PENDING"].includes(status);

  const canResolve = !["RESOLVED", "REJECTED", "CLOSED"].includes(status);

  async function handleFreeze() {
    setLoading(true);
    await freezeDisputeAmount(disputeId);
    setLoading(false);
    router.refresh();
  }

  async function handleResolve() {
    if (!resolution) return;
    setLoading(true);
    await resolveDispute(disputeId, resolution);
    setLoading(false);
    router.refresh();
  }

  async function handleReject() {
    if (!resolution) return;
    setLoading(true);
    await rejectDispute(disputeId, resolution);
    setLoading(false);
    router.refresh();
  }

  if (!canFreeze && !canResolve) {
    return <span className="text-xs text-muted-foreground">已結案</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {canFreeze && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleFreeze}
          disabled={loading}
          className="text-purple-600"
        >
          凍結
        </Button>
      )}
      {canResolve && (
        <div className="flex gap-1">
          <Input
            placeholder="處理結果"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            onClick={handleResolve}
            disabled={loading || !resolution}
          >
            解除
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleReject}
            disabled={loading || !resolution}
          >
            扣回
          </Button>
        </div>
      )}
    </div>
  );
}

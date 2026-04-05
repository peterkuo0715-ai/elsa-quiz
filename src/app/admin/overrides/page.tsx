import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverridePanel } from "./override-panel";

export default async function OverridesPage() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    include: {
      wallet: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">超級管理員 - 狀態覆寫</h2>
        <p className="text-muted-foreground">
          覆寫狀態、凍結錢包、強制調整（所有操作皆留稽核紀錄）
        </p>
      </div>

      {/* Wallet Freeze/Unfreeze */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">錢包凍結 / 解凍</CardTitle>
        </CardHeader>
        <CardContent>
          <OverridePanel
            merchants={merchants.map((m) => ({
              id: m.id,
              name: m.name,
              isFrozen: m.wallet?.isFrozen || false,
              frozenReason: m.wallet?.frozenReason || null,
              payoutSuspended: m.wallet?.payoutSuspended || false,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

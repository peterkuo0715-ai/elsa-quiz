import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function OverridesPage() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    include: { wallet: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">超級管理員 - 狀態覆寫</h2>
        <p className="text-muted-foreground">v2 架構 — 覆寫功能升級中</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">商家錢包狀態</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {merchants.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded border p-3">
                <span className="font-medium">{m.name}</span>
                <div className="flex gap-2">
                  {m.wallet?.isFrozen && <Badge className="bg-red-100 text-red-800 border-0">凍結</Badge>}
                  {m.wallet?.payoutSuspended && <Badge className="bg-orange-100 text-orange-800 border-0">停提領</Badge>}
                  {!m.wallet?.isFrozen && !m.wallet?.payoutSuspended && <Badge className="bg-green-100 text-green-800 border-0">正常</Badge>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdjustmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">手動調整單</h2>
        <p className="text-muted-foreground">建立與管理手動調整（v2 架構升級中）</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">功能開發中</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">手動調整單功能將在下一版本完成，目前可透過超級管理員覆寫功能處理。</p>
        </CardContent>
      </Card>
    </div>
  );
}

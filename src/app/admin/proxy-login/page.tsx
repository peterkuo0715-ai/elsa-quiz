import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProxyLoginPanel } from "./proxy-login-panel";

export default async function ProxyLoginPage() {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true },
    include: {
      users: {
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">代理登入</h2>
        <p className="text-muted-foreground">
          以商家視角查看系統（所有代理登入操作皆留稽核紀錄）
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">選擇商家帳號</CardTitle>
        </CardHeader>
        <CardContent>
          <ProxyLoginPanel
            merchants={merchants.map((m) => ({
              id: m.id,
              name: m.name,
              users: m.users,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

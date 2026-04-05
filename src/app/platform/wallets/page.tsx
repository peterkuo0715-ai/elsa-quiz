import { getAllMerchantWallets } from "@/server/queries/wallet.queries";
import { prisma } from "@/server/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { moneyFormat } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function PlatformWalletsPage() {
  const data = await getAllMerchantWallets();

  const riskProfiles = await prisma.merchantRiskProfile.findMany();
  const riskMap = new Map(riskProfiles.map((r) => [r.merchantId, r.riskLevel]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">商家總帳管理</h2>
        <p className="text-muted-foreground">查看所有商家 wallet 狀態</p>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商家名稱</TableHead>
              <TableHead className="text-right">待清款</TableHead>
              <TableHead className="text-right">可提領</TableHead>
              <TableHead className="text-right">Reserve</TableHead>
              <TableHead className="text-right">提領中</TableHead>
              <TableHead>風險等級</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.wallets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  無商家資料
                </TableCell>
              </TableRow>
            ) : (
              data.wallets.map((w) => {
                const risk = riskMap.get(w.merchant.id) || "LOW";
                const riskColors: Record<string, string> = {
                  LOW: "bg-green-100 text-green-800",
                  MEDIUM: "bg-yellow-100 text-yellow-800",
                  HIGH: "bg-red-100 text-red-800",
                };
                return (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">
                      {w.merchant.name}
                      <br />
                      <span className="text-xs text-muted-foreground">
                        {w.merchant.taxId}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {moneyFormat(w.balances.pending)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium text-green-600">
                      {moneyFormat(w.balances.available)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-blue-600">
                      {moneyFormat(w.balances.reserved)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-purple-600">
                      {moneyFormat(w.balances.inTransit)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-0 ${riskColors[risk] || ""}`}
                      >
                        {risk}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {w.isFrozen && (
                        <Badge className="bg-red-100 text-red-800 border-0">凍結</Badge>
                      )}
                      {w.payoutSuspended && (
                        <Badge className="bg-orange-100 text-orange-800 border-0">
                          停提領
                        </Badge>
                      )}
                      {!w.isFrozen && !w.payoutSuspended && (
                        <span className="text-xs text-green-600">正常</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

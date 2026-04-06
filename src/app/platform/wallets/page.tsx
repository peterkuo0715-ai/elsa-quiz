import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { moneyFormat } from "@/lib/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function PlatformWalletsPage() {
  const wallets = await prisma.merchantWallet.findMany({
    include: { merchant: { select: { id: true, name: true, taxId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const TX = prisma as unknown as Parameters<typeof LedgerService.getBalances>[0];
  const walletsWithBalances = await Promise.all(
    wallets.map(async (w) => ({
      ...w,
      balances: await LedgerService.getBalances(TX, w.id),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">商家總帳管理</h2>
        <p className="text-muted-foreground">所有商家 wallet 狀態（v2 sub_order 架構）</p>
      </div>
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商家</TableHead>
              <TableHead className="text-right">待清款</TableHead>
              <TableHead className="text-right">可提領</TableHead>
              <TableHead className="text-right">Reserve</TableHead>
              <TableHead className="text-right">提領中</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {walletsWithBalances.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.merchant.name}<br /><span className="text-xs text-muted-foreground">{w.merchant.taxId}</span></TableCell>
                <TableCell className="text-right text-sm">{moneyFormat(w.balances.pending)}</TableCell>
                <TableCell className="text-right text-sm font-medium text-green-600">{moneyFormat(w.balances.available)}</TableCell>
                <TableCell className="text-right text-sm text-blue-600">{moneyFormat(w.balances.reserved)}</TableCell>
                <TableCell className="text-right text-sm text-purple-600">{moneyFormat(w.balances.inTransit)}</TableCell>
                <TableCell>
                  {w.isFrozen && <Badge className="bg-red-100 text-red-800 border-0">凍結</Badge>}
                  {w.payoutSuspended && <Badge className="bg-orange-100 text-orange-800 border-0">停提領</Badge>}
                  {!w.isFrozen && !w.payoutSuspended && <span className="text-xs text-green-600">正常</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMerchantStatements } from "@/server/queries/statement.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { moneyFormat } from "@/lib/money";
import { FileBarChart, Download } from "lucide-react";
import { GenerateStatementButton } from "./generate-statement-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function StatementsPage() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const statements = await getMerchantStatements(session.user.merchantId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">月度對帳單</h2>
          <p className="text-muted-foreground">
            下載正式月度對帳單 XLSX
          </p>
        </div>
        <GenerateStatementButton merchantId={session.user.merchantId} />
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>月份</TableHead>
              <TableHead className="text-right">期初餘額</TableHead>
              <TableHead className="text-right">總收入</TableHead>
              <TableHead className="text-right">總扣款</TableHead>
              <TableHead className="text-right">總提領</TableHead>
              <TableHead className="text-right">期末餘額</TableHead>
              <TableHead>產生時間</TableHead>
              <TableHead>下載</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  尚無對帳單，請點擊右上角產生
                </TableCell>
              </TableRow>
            ) : (
              statements.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.year} 年 {s.month} 月
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {moneyFormat(s.openingBalanceTaxIncl.toString())}
                  </TableCell>
                  <TableCell className="text-right text-sm text-green-600">
                    {moneyFormat(s.totalIncomeTaxIncl.toString())}
                  </TableCell>
                  <TableCell className="text-right text-sm text-red-600">
                    {moneyFormat(s.totalDeductionsTaxIncl.toString())}
                  </TableCell>
                  <TableCell className="text-right text-sm text-purple-600">
                    {moneyFormat(s.totalPayoutsTaxIncl.toString())}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {moneyFormat(s.closingBalanceTaxIncl.toString())}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.generatedAt
                      ? new Date(s.generatedAt).toLocaleDateString("zh-TW")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <a
                      href={`/api/export/statement/${s.id}?format=xlsx`}
                      download
                    >
                      <Button size="sm" variant="outline">
                        <Download className="mr-1 h-3 w-3" />
                        XLSX
                      </Button>
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

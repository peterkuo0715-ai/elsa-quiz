export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getWalletBalances } from "@/server/queries/wallet.queries";
import { getMerchantPayouts, getMerchantBankAccounts } from "@/server/queries/payout.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { moneyFormat } from "@/lib/money";
import { Wallet, AlertTriangle } from "lucide-react";
import { PayoutRequestForm } from "./payout-request-form";
import { PayoutHistoryTable } from "./payout-history-table";

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);

  const [balances, bankAccounts, payouts] = await Promise.all([
    getWalletBalances(session.user.merchantId),
    getMerchantBankAccounts(session.user.merchantId),
    getMerchantPayouts({
      merchantId: session.user.merchantId,
      page,
    }),
  ]);

  const canPayout =
    !balances.isFrozen &&
    !balances.payoutSuspended &&
    balances.available.greaterThan(0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">提領</h2>
        <p className="text-muted-foreground">申請提領與查看提領紀錄</p>
      </div>

      {/* Available Balance */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">可提領餘額</CardTitle>
            <Wallet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {moneyFormat(balances.available)}
            </div>
            {balances.payoutSuspended && (
              <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
                <AlertTriangle className="h-3 w-3" />
                因負餘額已暫停提領
              </div>
            )}
            {balances.isFrozen && (
              <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
                <AlertTriangle className="h-3 w-3" />
                錢包已被凍結
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payout Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">申請提領</CardTitle>
          </CardHeader>
          <CardContent>
            {canPayout ? (
              <PayoutRequestForm
                availableBalance={balances.available.toString()}
                bankAccounts={bankAccounts.map((ba) => ({
                  id: ba.id,
                  label: `${ba.bankName} ${ba.accountNumber.slice(-4)} (${ba.accountName})`,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {balances.isFrozen
                  ? "錢包已被凍結，無法提領"
                  : balances.payoutSuspended
                    ? "因負餘額已暫停提領"
                    : "目前無可提領餘額"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payout History */}
      <div>
        <h3 className="mb-4 text-lg font-semibold">提領紀錄</h3>
        <PayoutHistoryTable
          items={payouts.items}
          total={payouts.total}
          page={payouts.page}
          totalPages={payouts.totalPages}
        />
      </div>
    </div>
  );
}

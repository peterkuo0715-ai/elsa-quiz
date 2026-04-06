export const dynamic = "force-dynamic";
import { getPendingBankChangeRequests } from "@/server/queries/payout.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BankApprovalList } from "./bank-approval-list";

export default async function BankApprovalsPage() {
  const requests = await getPendingBankChangeRequests();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">銀行帳號審核</h2>
        <p className="text-muted-foreground">審核商家銀行帳號變更申請</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            待審核申請 ({requests.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BankApprovalList requests={requests} />
        </CardContent>
      </Card>
    </div>
  );
}

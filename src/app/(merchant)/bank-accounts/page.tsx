import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getMerchantBankAccounts,
  getMerchantBankChangeRequests,
} from "@/server/queries/payout.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Clock, CheckCircle, XCircle } from "lucide-react";
import { BankAccountChangeForm } from "./bank-account-change-form";
import { cn } from "@/lib/utils";

const CHANGE_STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING_REVIEW: { label: "審核中", color: "bg-yellow-100 text-yellow-800", icon: Clock },
  APPROVED: { label: "已核准", color: "bg-green-100 text-green-800", icon: CheckCircle },
  REJECTED: { label: "已拒絕", color: "bg-red-100 text-red-800", icon: XCircle },
  EFFECTIVE: { label: "已生效", color: "bg-green-100 text-green-800", icon: CheckCircle },
};

export default async function BankAccountsPage() {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const [accounts, changeRequests] = await Promise.all([
    getMerchantBankAccounts(session.user.merchantId),
    getMerchantBankChangeRequests(session.user.merchantId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">銀行帳號管理</h2>
        <p className="text-muted-foreground">
          查看目前生效帳號與申請變更
        </p>
      </div>

      {/* Current Active Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            目前生效帳號
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未設定銀行帳號</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between rounded-md border p-4"
                >
                  <div>
                    <p className="font-medium">
                      {acc.bankName}{" "}
                      {acc.branchName && `- ${acc.branchName}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      帳號: {acc.accountNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      戶名: {acc.accountName}
                    </p>
                  </div>
                  <Badge className="bg-green-100 text-green-800 border-0">
                    生效中
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Request Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">申請帳號變更</CardTitle>
          <p className="text-xs text-muted-foreground">
            變更需經平台財務審核後才會生效
          </p>
        </CardHeader>
        <CardContent>
          <BankAccountChangeForm />
        </CardContent>
      </Card>

      {/* Change Request History */}
      {changeRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">變更申請歷史</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {changeRequests.map((req) => {
                const statusInfo = CHANGE_STATUS_MAP[req.status] || {
                  label: req.status,
                  color: "bg-gray-100 text-gray-800",
                  icon: Clock,
                };
                return (
                  <div
                    key={req.id}
                    className="flex items-start justify-between rounded-md border p-3"
                  >
                    <div className="text-sm">
                      <p className="font-medium">
                        {req.bankName} - {req.accountNumber}
                      </p>
                      <p className="text-muted-foreground">
                        戶名: {req.accountName}
                      </p>
                      {req.rejectionReason && (
                        <p className="mt-1 text-xs text-red-600">
                          拒絕原因: {req.rejectionReason}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(statusInfo.color, "border-0")}
                    >
                      {statusInfo.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

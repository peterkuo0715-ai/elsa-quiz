import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReconciliationList } from "@/server/queries/reconciliation.queries";
import { SettlementItemStatus } from "@/generated/prisma";
import { ReconciliationTable } from "./reconciliation-table";

interface SearchParams {
  page?: string;
  status?: string;
  orderNumber?: string;
  sku?: string;
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.merchantId) redirect("/login");

  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);

  const data = await getReconciliationList({
    merchantId: session.user.merchantId,
    page,
    pageSize: 20,
    status: params.status as SettlementItemStatus | undefined,
    orderNumber: params.orderNumber,
    sku: params.sku,
    storeId: params.storeId,
    dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
    dateTo: params.dateTo ? new Date(params.dateTo) : undefined,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">對帳明細</h2>
        <p className="text-muted-foreground">
          查看每筆訂單的帳務明細與結算狀態
        </p>
      </div>
      <ReconciliationTable
        items={data.items}
        total={data.total}
        page={data.page}
        totalPages={data.totalPages}
      />
    </div>
  );
}

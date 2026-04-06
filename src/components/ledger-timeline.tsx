import { cn } from "@/lib/utils";
import { moneyFormat } from "@/lib/money";
import { LedgerEntryType, WalletBucket } from "@/generated/prisma";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

interface LedgerEntry {
  id: string;
  entryType: LedgerEntryType;
  bucket: WalletBucket;
  amount: string;
  amountTaxIncl: string;
  amountTaxExcl: string;
  balanceAfter: string;
  description?: string | null;
  createdAt: Date | string;
}

interface LedgerTimelineProps {
  entries: LedgerEntry[];
  className?: string;
}

const entryTypeLabels: Record<LedgerEntryType, string> = {
  ORDER_PENDING_SETTLEMENT: "待結算",
  SETTLEMENT_RELEASED: "鑑賞期釋放",
  COMMISSION_CHARGED: "平台抽成",
  PAYMENT_FEE_CHARGED: "金流手續費",
  INVOICE_FEE_CHARGED: "發票費",
  SHIPPING_INCOME: "運費入帳",
  HI_COIN_PLATFORM_SUBSIDY: "嗨幣補貼(記錄)",
  REFUND_DEBIT: "退款扣回",
  PARTIAL_REFUND_DEBIT: "部分退款扣回",
  REFUND_COMMISSION_RETURN: "退款抽成返還",
  DISPUTE_FREEZE_HOLD: "爭議凍結",
  DISPUTE_FREEZE_RELEASE: "爭議解凍",
  DISPUTE_DEBIT: "爭議扣款",
  RESERVE_HOLD: "保留金扣留",
  RESERVE_RELEASE: "保留金釋放",
  PAYOUT_REQUESTED: "提領申請",
  PAYOUT_SENT: "提領完成",
  PAYOUT_FAILED_RETURN: "提領失敗退回",
  MANUAL_ADJUSTMENT_CREDIT: "手動調整(貸方)",
  MANUAL_ADJUSTMENT_DEBIT: "手動調整(借方)",
  REVERSAL: "沖銷",
  NEGATIVE_BALANCE_CARRY: "負餘額結轉",
  PLATFORM_ABSORBED: "平台吸收差額",
};

const bucketLabels: Record<WalletBucket, string> = {
  PENDING: "待清",
  AVAILABLE: "可用",
  RESERVED: "保留",
  IN_TRANSIT: "提領中",
};

export function LedgerTimeline({ entries, className }: LedgerTimelineProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {entries.map((entry, index) => {
        const isCredit = Number(entry.amount) > 0;
        const isLast = index === entries.length - 1;

        return (
          <div key={entry.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "h-3 w-3 rounded-full border-2",
                  isCredit
                    ? "border-green-500 bg-green-100"
                    : "border-red-500 bg-red-100"
                )}
              />
              {!isLast && <div className="w-px flex-1 bg-gray-200" />}
            </div>

            <div className="flex-1 pb-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {entryTypeLabels[entry.entryType]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bucketLabels[entry.bucket]} bucket
                    {entry.description && ` • ${entry.description}`}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isCredit ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {isCredit ? "+" : ""}
                    {moneyFormat(entry.amountTaxIncl)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {"餘額 "}{moneyFormat(entry.balanceAfter)}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {format(new Date(entry.createdAt), "yyyy/MM/dd HH:mm:ss", {
                  locale: zhTW,
                })}
              </p>
            </div>
          </div>
        );
      })}

      {entries.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          尚無帳務紀錄
        </p>
      )}
    </div>
  );
}

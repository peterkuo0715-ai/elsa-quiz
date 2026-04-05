import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { moneyFormat } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Clock, Wallet, Shield, Truck } from "lucide-react";

interface WalletBalances {
  pending: string | number;
  available: string | number;
  reserved: string | number;
  inTransit: string | number;
}

interface WalletSummaryCardProps {
  balances: WalletBalances;
  className?: string;
}

const bucketConfig = [
  {
    key: "pending" as const,
    label: "待清款",
    icon: Clock,
    color: "text-yellow-600",
    description: "已付款但未過鑑賞期",
  },
  {
    key: "available" as const,
    label: "可提領",
    icon: Wallet,
    color: "text-green-600",
    description: "已結算可申請提領",
  },
  {
    key: "reserved" as const,
    label: "Reserve",
    icon: Shield,
    color: "text-blue-600",
    description: "保留金 + 爭議凍結",
  },
  {
    key: "inTransit" as const,
    label: "提領中",
    icon: Truck,
    color: "text-purple-600",
    description: "已提交銀行處理中",
  },
];

export function WalletSummaryCard({ balances, className }: WalletSummaryCardProps) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-4", className)}>
      {bucketConfig.map((bucket) => (
        <Card key={bucket.key}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{bucket.label}</CardTitle>
            <bucket.icon className={cn("h-4 w-4", bucket.color)} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {moneyFormat(balances[bucket.key])}
            </div>
            <p className="text-xs text-muted-foreground">{bucket.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

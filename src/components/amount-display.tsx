import { moneyFormat } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AmountDisplayProps {
  taxIncl: string | number;
  taxExcl: string | number;
  compact?: boolean;
  className?: string;
  showSign?: boolean;
}

export function AmountDisplay({
  taxIncl,
  taxExcl,
  compact = false,
  className,
  showSign = false,
}: AmountDisplayProps) {
  const inclFormatted = moneyFormat(taxIncl);
  const exclFormatted = moneyFormat(taxExcl);
  const isNegative = Number(taxIncl) < 0;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "cursor-help",
            isNegative && "text-red-600",
            className
          )}
        >
          {showSign && !isNegative ? "+" : ""}
          {inclFormatted}
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>{"含稅："}{inclFormatted}</div>
            <div>{"未稅："}{exclFormatted}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <div
        className={cn(
          "text-sm font-medium",
          isNegative && "text-red-600"
        )}
      >
        {showSign && !isNegative ? "+" : ""}
        {inclFormatted}
        <span className="ml-1 text-xs text-muted-foreground">(含稅)</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {exclFormatted} (未稅)
      </div>
    </div>
  );
}

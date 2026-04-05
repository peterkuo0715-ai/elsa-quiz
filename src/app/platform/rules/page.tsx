import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APPRECIATION_PERIOD_DAYS, PAYOUT_BLACKOUT_START_HOUR, PAYOUT_BLACKOUT_END_HOUR, DEFAULT_TAX_RATE, IDEMPOTENCY_KEY_TTL_HOURS, SETTLEMENT_BATCH_CHUNK_SIZE } from "@/lib/constants";
import { Clock, Shield, Calculator, Key } from "lucide-react";

export default function RulesPage() {
  const rules = [
    {
      category: "結算規則",
      icon: Calculator,
      items: [
        { label: "鑑賞期天數", value: `${APPRECIATION_PERIOD_DAYS} 天`, desc: "物流 Delivered 後開始計算" },
        { label: "結算批次大小", value: `${SETTLEMENT_BATCH_CHUNK_SIZE} 筆/批`, desc: "每次交易處理的上限" },
        { label: "平台抽成計算基礎", value: "折扣後成交價（未稅）", desc: "非原始售價" },
        { label: "運費歸屬", value: "100% 歸商家", desc: "不參與抽成計算" },
      ],
    },
    {
      category: "提領規則",
      icon: Clock,
      items: [
        { label: "禁止提領時段", value: `${PAYOUT_BLACKOUT_START_HOUR}:00 ~ ${PAYOUT_BLACKOUT_END_HOUR}:00`, desc: "此時段內不接受提領申請" },
        { label: "提領上限", value: "無上限", desc: "可全額提領" },
        { label: "提領模式", value: "自主提領", desc: "商家需主動申請" },
      ],
    },
    {
      category: "退款規則",
      icon: Shield,
      items: [
        { label: "抽成退還", value: "按比例退", desc: "退款金額 / 原始金額 * 抽成" },
        { label: "金流手續費", value: "不退", desc: "平台吸收" },
        { label: "活動成本", value: "按比例收回", desc: "退款金額 / 原始金額 * 活動折扣" },
        { label: "已提領後退款", value: "可形成負餘額", desc: "暫停提領直到補足" },
      ],
    },
    {
      category: "爭議規則",
      icon: Shield,
      items: [
        { label: "凍結範圍", value: "僅爭議金額", desc: "不可全單凍結" },
      ],
    },
    {
      category: "稅務規則",
      icon: Calculator,
      items: [
        { label: "預設稅率", value: `${(DEFAULT_TAX_RATE * 100).toFixed(0)}%`, desc: "台灣 VAT" },
        { label: "顯示方式", value: "含稅 / 未稅 雙顯示", desc: "所有報表與帳務明細" },
      ],
    },
    {
      category: "系統規則",
      icon: Key,
      items: [
        { label: "Idempotency Key TTL", value: `${IDEMPOTENCY_KEY_TTL_HOURS} 小時`, desc: "防重複 key 過期時間" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">規則設定</h2>
        <p className="text-muted-foreground">查看平台帳務規則（目前為環境變數設定，未來可動態調整）</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rules.map((group) => (
          <Card key={group.category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <group.icon className="h-4 w-4" />
                {group.category}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <span className="text-sm font-mono">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

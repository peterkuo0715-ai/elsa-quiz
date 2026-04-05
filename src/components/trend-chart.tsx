"use client";

import { useState } from "react";

interface DataPoint {
  date: string;
  income: number;
  deductions: number;
}

interface TrendChartProps {
  data7: DataPoint[];
  data30: DataPoint[];
}

export function TrendChart({ data7, data30 }: TrendChartProps) {
  const [period, setPeriod] = useState<7 | 30>(7);
  const data = period === 7 ? data7 : data30;

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        尚無趨勢資料
      </div>
    );
  }

  const maxVal = Math.max(
    ...data.map((d) => Math.max(d.income, d.deductions)),
    1
  );

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const xStep = chartW / Math.max(data.length - 1, 1);

  function toPath(values: number[]) {
    return values
      .map((v, i) => {
        const x = padding.left + i * xStep;
        const y = padding.top + chartH - (v / maxVal) * chartH;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }

  const incomePath = toPath(data.map((d) => d.income));
  const deductionPath = toPath(data.map((d) => d.deductions));

  // Show labels at intervals
  const labelInterval = period === 7 ? 1 : 5;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-green-500" />
            入帳
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-red-400" />
            扣款
          </span>
        </div>
        <div className="flex rounded-md border text-xs">
          <button
            onClick={() => setPeriod(7)}
            className={`px-3 py-1 transition-colors ${period === 7 ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
          >
            7 天
          </button>
          <button
            onClick={() => setPeriod(30)}
            className={`px-3 py-1 transition-colors ${period === 30 ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
          >
            30 天
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartH - pct * chartH;
          return (
            <line
              key={pct}
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#f0f0f0"
              strokeWidth="1"
            />
          );
        })}

        {/* Income line */}
        <path d={incomePath} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" />

        {/* Deduction line */}
        <path d={deductionPath} fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="6 3" />

        {/* Dots */}
        {data.map((d, i) => {
          const x = padding.left + i * xStep;
          return (
            <g key={i}>
              <circle cx={x} cy={padding.top + chartH - (d.income / maxVal) * chartH} r="3" fill="#22c55e" />
              <circle cx={x} cy={padding.top + chartH - (d.deductions / maxVal) * chartH} r="3" fill="#f87171" />
            </g>
          );
        })}

        {/* X labels */}
        {data.map((d, i) => {
          if (i % labelInterval !== 0 && i !== data.length - 1) return null;
          const x = padding.left + i * xStep;
          return (
            <text
              key={i}
              x={x}
              y={height - 5}
              textAnchor="middle"
              fontSize="10"
              fill="#999"
            >
              {d.date}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

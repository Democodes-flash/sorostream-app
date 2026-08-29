"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { type StreamData } from "@/src/lib/sorostream";
import type { StreamHistoryEntry } from "@/src/lib/export";

interface StreamAnalyticsChartsProps {
  stream: StreamData;
  historyEntries: StreamHistoryEntry[];
}

type DateRange = "7d" | "30d" | "90d" | "all";

const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "All", value: "all" },
];

function stroopsToDisplay(stroops: number): string {
  const val = stroops / 10_000_000;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  return val.toFixed(2);
}

export default function StreamAnalyticsCharts({
  stream,
  historyEntries,
}: StreamAnalyticsChartsProps) {
  const [dateRange, setDateRange] = useState<DateRange>("all");

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    const cutoffMap: Record<DateRange, number> = {
      "7d": now - 7 * 86_400_000,
      "30d": now - 30 * 86_400_000,
      "90d": now - 90 * 86_400_000,
      all: 0,
    };
    const cutoff = cutoffMap[dateRange];
    return historyEntries.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff
    );
  }, [historyEntries, dateRange]);

  const withdrawalChartData = useMemo(() => {
    let cumulative = 0;
    return filteredEntries
      .filter((e) => e.type === "withdrawal")
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      .map((e) => {
        cumulative += Number(e.amount);
        const date = new Date(e.timestamp);
        return {
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          cumulative,
          withdrawal: Number(e.amount),
        };
      });
  }, [filteredEntries]);

  const balanceChartData = useMemo(() => {
    const deposit = stream.deposit;
    let withdrawn = 0;
    const points: {
      date: string;
      remaining: number;
      streamed: number;
    }[] = [];

    const startTime = new Date(stream.startTime).getTime();
    const endTime = new Date(stream.endTime).getTime();
    const flowRate = stream.flowRate;
    const now = Date.now();

    const step = Math.max(
      1,
      Math.floor(
        (Math.min(endTime, now) - startTime) / 30
      )
    );

    const withdrawalsByTime = new Map<number, number>();
    for (const e of filteredEntries) {
      if (e.type === "withdrawal") {
        const ts = new Date(e.timestamp).getTime();
        withdrawalsByTime.set(
          ts,
          (withdrawalsByTime.get(ts) ?? 0) + Number(e.amount)
        );
      }
    }

    for (
      let t = startTime;
      t <= Math.min(endTime, now);
      t += step * 86_400_000
    ) {
      const elapsed = Math.max(0, (t - startTime) / 1000);
      const streamed = Math.min(deposit, flowRate * elapsed);
      const withdrawalAtTime = withdrawalsByTime.get(t) ?? 0;
      withdrawn += withdrawalAtTime;
      const remaining = Math.max(0, deposit - streamed);
      const date = new Date(t);
      points.push({
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        remaining,
        streamed,
      });
    }

    return points;
  }, [stream, filteredEntries]);

  const hasWithdrawalData = withdrawalChartData.length > 0;
  const hasBalanceData = balanceChartData.length > 0;

  if (!hasWithdrawalData && !hasBalanceData) {
    return (
      <div
        className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700"
        role="status"
      >
        <svg
          className="mx-auto h-12 w-12 text-gray-600 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
        <p className="text-gray-400 font-medium text-sm">
          No analytics data yet
        </p>
        <p className="text-gray-500 text-xs mt-1 leading-relaxed max-w-sm mx-auto">
          Analytics charts will appear here once there is withdrawal history
          for this stream.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center gap-2" role="group" aria-label="Date range filter">
        <span className="text-xs text-gray-500 mr-1">Range:</span>
        {DATE_RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDateRange(opt.value)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
              dateRange === opt.value
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-600"
            }`}
            aria-pressed={dateRange === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Cumulative Withdrawal Chart */}
      {hasWithdrawalData && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">
            Cumulative Withdrawals
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Total amount withdrawn over time
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={withdrawalChartData}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="grad-withdrawal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                tickFormatter={stroopsToDisplay}
              />
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                }}
                formatter={((value: number) => [
                  `${stroopsToDisplay(value)} ${stream.token}`,
                  "Withdrawn",
                ]) as any}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#grad-withdrawal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Remaining Balance Chart */}
      {hasBalanceData && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">
            Remaining Balance
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            How the stream balance has changed over time
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={balanceChartData}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                tickFormatter={stroopsToDisplay}
              />
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 8,
                }}
                formatter={((value: number, name: string) => [
                  `${stroopsToDisplay(value)} ${stream.token}`,
                  name === "remaining" ? "Remaining" : "Streamed",
                ]) as any}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="remaining"
                name="Remaining"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="streamed"
                name="Streamed"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

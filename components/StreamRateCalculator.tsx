"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "@/src/lib/i18n";

interface StreamRateCalculatorProps {
  amount?: string;
  duration?: number;
  onRateCalculated?: (rate: number) => void;
}

const STROOPS_PER_UNIT = 10_000_000;

export default function StreamRateCalculator({
  amount: initialAmount = "",
  duration: initialDuration = 0,
  onRateCalculated,
}: StreamRateCalculatorProps) {
  const t = useTranslations("stream_new");
  const [amount, setAmount] = useState(initialAmount);
  const [duration, setDuration] = useState(initialDuration);
  const [calculatedRate, setCalculatedRate] = useState<number | null>(null);
  const [ratePerDay, setRatePerDay] = useState<number | null>(null);

  // Recalculate rate whenever amount or duration changes
  useEffect(() => {
    if (amount && duration > 0) {
      const amountNum = parseFloat(amount);
      if (!isNaN(amountNum) && amountNum > 0) {
        const totalStroops = amountNum * STROOPS_PER_UNIT;
        const rate = totalStroops / duration;
        setCalculatedRate(rate);
        setRatePerDay(rate * 86400); // 86400 seconds in a day
        onRateCalculated?.(rate);
        return;
      }
    }
    setCalculatedRate(null);
    setRatePerDay(null);
    onRateCalculated?.(0);
  }, [amount, duration, onRateCalculated]);

  const formatDuration = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(" ");
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-green-600 dark:text-green-400"
          aria-hidden="true"
        >
          <path d="M12 2v20M2 12h20" />
        </svg>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Stream Rate Calculator
        </h3>
      </div>

      {/* Calculator display - read-only summary */}
      {calculatedRate !== null && amount && duration > 0 && (
        <div className="bg-white dark:bg-gray-700 rounded-lg p-3 space-y-2 border border-green-200 dark:border-green-800">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-600 dark:text-gray-400 text-xs font-medium">
                Total Amount
              </div>
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {parseFloat(amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 7,
                })}{" "}
                units
              </div>
            </div>
            <div>
              <div className="text-gray-600 dark:text-gray-400 text-xs font-medium">
                Duration
              </div>
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {formatDuration(duration)}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
            <div className="mb-2">
              <div className="text-gray-600 dark:text-gray-400 text-xs font-medium">
                Flow Rate
              </div>
              <div className="text-lg font-bold text-green-600 dark:text-green-400 font-mono">
                {calculatedRate.toFixed(0)} stroops/second
              </div>
            </div>

            <div>
              <div className="text-gray-600 dark:text-gray-400 text-xs font-medium">
                Flow Rate Per Day
              </div>
              <div className="text-sm font-mono text-gray-700 dark:text-gray-300">
                {ratePerDay?.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}{" "}
                stroops/day
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 pt-2">
            This calculation helps you set up your stream with the correct amount. The flow rate
            above is automatically calculated based on your total amount and duration.
          </div>
        </div>
      )}

      {/* Empty state when no values */}
      {(!calculatedRate || !amount || duration <= 0) && (
        <div className="bg-white dark:bg-gray-700 rounded-lg p-4 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>Enter amount and duration to calculate the stream rate</p>
        </div>
      )}
    </div>
  );
}

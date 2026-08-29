"use client";

import { useEffect, useState, useMemo } from "react";
import {
  type StreamData,
  formatStellarAmount,
  getStreamedAmount,
} from "@/src/lib/sorostream";
import {
  getStreamHealth,
  HEALTH_BADGE_CLASSES,
  type StreamHealthStatus,
} from "@/src/lib/streamHealth";
import StreamHealthBadge, {
  calculateHealthScore,
  getHealthTier,
} from "@/components/StreamHealthBadge";
import { type StreamHistoryEntry } from "@/src/lib/export";

interface StreamHealthCardProps {
  stream: StreamData;
  historyEntries?: StreamHistoryEntry[];
}

type FlowRateUnit = "day" | "week" | "month";

export default function StreamHealthCard({
  stream,
  historyEntries = [],
}: StreamHealthCardProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [flowUnit, setFlowUnit] = useState<FlowRateUnit>("day");

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const startMs = useMemo(() => new Date(stream.startTime).getTime(), [stream.startTime]);
  const endMs = useMemo(() => new Date(stream.endTime).getTime(), [stream.endTime]);
  const totalDurationMs = Math.max(1, endMs - startMs);

  const healthStatus: StreamHealthStatus = useMemo(() => {
    return getStreamHealth(stream, now);
  }, [stream, now]);

  const isEnded = healthStatus === "Expired" || stream.status === "Ended" || now >= endMs;
  const isCancelled = stream.status === "Cancelled";
  const isPaused = stream.status === "Paused";

  // Progress percentage
  const progressPct = useMemo(() => {
    if (isCancelled) {
      const streamed = getStreamedAmount(stream);
      return stream.deposit > 0
        ? Math.max(0, Math.min(100, (streamed / stream.deposit) * 100))
        : 0;
    }
    if (isEnded) return 100;
    const elapsed = now - startMs;
    return Math.max(0, Math.min(100, (elapsed / totalDurationMs) * 100));
  }, [isCancelled, isEnded, stream, now, startMs, totalDurationMs]);

  // Real-time time remaining calculation
  const timeRemainingText = useMemo(() => {
    if (isCancelled) return "Stream cancelled";
    if (isEnded) return "Stream completed";
    const diffMs = Math.max(0, endMs - now);
    const totalSecs = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return `${parts.join(" ")} remaining`;
  }, [isCancelled, isEnded, endMs, now]);

  // Flow rate in user-friendly units
  const flowPerSec = stream.flowRate / 10_000_000;
  const flowRateDisplay = useMemo(() => {
    const multiplier =
      flowUnit === "day"
        ? 86400
        : flowUnit === "week"
        ? 86400 * 7
        : 86400 * 30;
    const amount = (flowPerSec * multiplier).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    return `${amount} ${stream.token}/${flowUnit}`;
  }, [flowPerSec, flowUnit, stream.token]);

  // Settled & refund amounts
  const streamedStroops = getStreamedAmount(stream);
  const refundStroops = Math.max(0, stream.deposit - streamedStroops);

  // Health Score Calculation
  const healthScore = useMemo(() => {
    const elapsed = now - startMs;
    const timeRemainingRatio =
      totalDurationMs > 0
        ? Math.max(0, Math.min(1, 1 - elapsed / totalDurationMs))
        : 0;
    const estimatedStreamed = (stream.flowRate * Math.max(0, elapsed / 1000));
    const depositRemainingRatio =
      stream.deposit > 0
        ? Math.max(0, Math.min(1, 1 - estimatedStreamed / stream.deposit))
        : 0;
    const topUpCount = historyEntries.filter((e) => e.type === "top-up").length;
    return calculateHealthScore({
      depositRemainingRatio,
      timeRemainingRatio,
      topUpCount,
    });
  }, [now, startMs, totalDurationMs, stream.flowRate, stream.deposit, historyEntries]);

  const healthTier = getHealthTier(healthScore);

  return (
    <div
      className="bg-gray-800/90 border border-gray-700 rounded-xl p-5 shadow-lg space-y-4"
      data-testid="stream-health-card"
      role="region"
      aria-label="Stream Health"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700/60 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-white">Stream Health</h2>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${HEALTH_BADGE_CLASSES[healthStatus]}`}
            data-testid="health-status-badge"
          >
            {isEnded && stream.status !== "Cancelled" ? "Completed" : healthStatus}
          </span>
        </div>

        {!isCancelled && !isEnded && (
          <StreamHealthBadge
            score={healthScore}
            tier={healthTier}
            depositRemainingRatio={Math.max(
              0,
              Math.min(1, 1 - (stream.flowRate * Math.max(0, (now - startMs) / 1000)) / (stream.deposit || 1)),
            )}
            timeRemainingRatio={Math.max(
              0,
              Math.min(1, 1 - (now - startMs) / totalDurationMs),
            )}
            topUpCount={historyEntries.filter((e) => e.type === "top-up").length}
          />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {/* Countdown / Time remaining */}
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-gray-400 mb-1 font-medium">Time Remaining</p>
          <p
            className={`font-mono text-base sm:text-lg font-bold tabular-nums ${
              isCancelled
                ? "text-red-400"
                : isEnded
                ? "text-blue-400"
                : isPaused
                ? "text-yellow-400"
                : "text-green-400"
            }`}
            data-testid="health-time-remaining"
          >
            {timeRemainingText}
          </p>
        </div>

        {/* Current Flow Rate */}
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-400 font-medium">Flow Rate</p>
            <div className="flex gap-1 bg-gray-800 rounded p-0.5 text-[10px]">
              {(["day", "week", "month"] as FlowRateUnit[]).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setFlowUnit(unit)}
                  className={`px-1.5 py-0.5 rounded capitalize transition-colors ${
                    flowUnit === unit
                      ? "bg-green-700 text-white font-medium"
                      : "text-gray-400 hover:text-white"
                  }`}
                  aria-label={`Show flow rate per ${unit}`}
                >
                  /{unit[0]}
                </button>
              ))}
            </div>
          </div>
          <p
            className="font-mono text-base sm:text-lg font-bold text-white tabular-nums"
            data-testid="health-flow-rate"
          >
            {flowRateDisplay}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-400 font-medium">Completion Progress</span>
          <span className="font-mono font-semibold text-white">
            {progressPct.toFixed(1)}%
          </span>
        </div>
        <div
          className="h-2.5 w-full bg-gray-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Stream completion: ${progressPct.toFixed(1)}%`}
        >
          <div
            className={`h-full transition-all duration-300 ${
              isCancelled
                ? "bg-red-500"
                : isEnded
                ? "bg-blue-500"
                : "bg-green-500"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Expired / Ended streams details */}
      {isEnded && !isCancelled && (
        <div
          className="bg-blue-950/40 border border-blue-800/60 rounded-lg p-3 text-xs text-blue-200"
          data-testid="health-settled-info"
        >
          <p className="font-semibold text-blue-100 mb-1">Status: Completed</p>
          <p>
            Final settled amount:{" "}
            <span className="font-mono font-bold text-white">
              {formatStellarAmount(stream.deposit)} {stream.token}
            </span>
          </p>
        </div>
      )}

      {/* Cancelled streams details */}
      {isCancelled && (
        <div
          className="bg-red-950/40 border border-red-800/60 rounded-lg p-3 text-xs text-red-200 space-y-1"
          data-testid="health-cancelled-info"
        >
          <p className="font-semibold text-red-100">Status: Cancelled</p>
          <div className="flex justify-between">
            <span>Recipient Received:</span>
            <span className="font-mono font-bold text-white">
              {formatStellarAmount(streamedStroops)} {stream.token}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sender Refund:</span>
            <span className="font-mono font-bold text-white">
              {formatStellarAmount(refundStroops)} {stream.token}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

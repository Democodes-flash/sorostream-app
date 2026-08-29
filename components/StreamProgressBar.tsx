"use client";

import { useMemo } from "react";
import type { StreamData } from "@/src/lib/sorostream";
import { getStreamedAmount } from "@/src/lib/sorostream";

interface StreamProgressBarProps {
  stream: StreamData;
}

export default function StreamProgressBar({ stream }: StreamProgressBarProps) {
  const { percentage, isCompleted, elapsedText } = useMemo(() => {
    const start = new Date(stream.startTime).getTime();
    const end = new Date(stream.endTime).getTime();
    const now = Date.now();

    const totalDuration = end - start;

    if (totalDuration <= 0) {
      return { percentage: 0, isCompleted: false, elapsedText: "0%" };
    }

    // For cancelled streams, the recipient only received what dripped before
    // cancellation — not the full deposit. Use the pro-rated streamed amount
    // so the bar reflects the actual net received.
    if (stream.status === "Cancelled") {
      const streamed = getStreamedAmount(stream);
      const pct = stream.deposit > 0 ? (streamed / stream.deposit) * 100 : 0;
      const percentage = Math.max(0, Math.min(100, pct));
      return {
        percentage,
        isCompleted: true,
        elapsedText: `${Math.round(percentage)}%`,
      };
    }

    // Clamp the effective current time to [start, end] so that:
    //  - future streams (now < start) always show 0%
    //  - completed streams (now > end) always show 100%
    const effectiveNow = Math.min(Math.max(now, start), end);
    const elapsed = effectiveNow - start;

    const rawPercentage = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
    const isCompleted = stream.status === "Ended" || now >= end;
    const finalPercentage = isCompleted ? 100 : rawPercentage;

    return {
      percentage: finalPercentage,
      isCompleted,
      elapsedText: `${Math.round(finalPercentage)}%`,
    };
  }, [stream]);

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-400">Progress</span>
        <span className={`font-medium ${isCompleted ? "text-green-400" : "text-white"}`}>
          {isCompleted ? "Completed" : elapsedText}
        </span>
      </div>
      <div className="relative pt-1 pb-4">
        <div
          className="relative h-3 bg-gray-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(percentage)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Stream progress: ${elapsedText}`}
        >
          <div
            className={`h-full transition-all duration-500 ease-out ${
              isCompleted ? "bg-green-500" : "bg-green-600"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Milestone markers at 25%, 50%, 75% */}
        {[25, 50, 75].map((m) => {
          const reached = percentage >= m;
          return (
            <div
              key={m}
              data-testid={`milestone-marker-${m}`}
              data-reached={reached}
              className="absolute top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${m}%` }}
            >
              <div
                className={`w-1 h-3 rounded-full transition-colors ${
                  reached ? "bg-green-400 shadow-sm" : "bg-gray-500/70"
                }`}
              />
              <span
                className={`text-[10px] mt-0.5 font-mono font-medium transition-colors ${
                  reached ? "text-green-300 font-semibold" : "text-gray-500"
                }`}
              >
                {m}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        {isCompleted
          ? "Stream has finished"
          : `${Math.round(percentage)}% of total duration elapsed`}
      </p>
    </div>
  );
}

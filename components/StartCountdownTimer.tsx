"use client";

import { useEffect, useRef, useState } from "react";

interface StartCountdownTimerProps {
  /** Unix timestamp in seconds for the scheduled start. */
  scheduledStartTime: number;
}

function computeRemaining(unixSeconds: number) {
  const diff = unixSeconds * 1000 - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, started: true };
  const totalSecs = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSecs / 86400),
    hours: Math.floor((totalSecs % 86400) / 3600),
    minutes: Math.floor((totalSecs % 3600) / 60),
    seconds: totalSecs % 60,
    started: false,
  };
}

/**
 * Countdown timer targeting a future stream start time.
 * Renders a pulsing "Scheduled" chip while counting down, and a
 * "Stream is live!" chip once the start time is reached.
 *
 * Uses the Page Visibility API to recalculate elapsed time on tab refocus
 * instead of relying on accumulated interval ticks, which are throttled by the
 * browser when the tab is backgrounded for more than ~30 s. This prevents the
 * "freeze then jump" behaviour described in issue #524.
 */
export default function StartCountdownTimer({ scheduledStartTime }: StartCountdownTimerProps) {
  const [remaining, setRemaining] = useState(() => computeRemaining(scheduledStartTime));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (remaining.started) return;

    function recalculate() {
      const next = computeRemaining(scheduledStartTime);
      setRemaining(next);
      if (next.started && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function startInterval() {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(recalculate, 1000);
    }

    recalculate();
    startInterval();

    // On tab refocus, recalculate immediately using Date.now() to correct any
    // drift that built up while the browser throttled the interval.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        recalculate();
        startInterval();
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scheduledStartTime, remaining.started]);

  if (remaining.started) {
    return (
      <div className="flex items-center justify-center gap-2 py-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-900 text-green-300 border border-green-700">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
          Stream is live!
        </span>
      </div>
    );
  }

  const parts = [
    { label: "days", value: remaining.days },
    { label: "hrs",  value: remaining.hours },
    { label: "min",  value: remaining.minutes },
    { label: "sec",  value: remaining.seconds },
  ];

  return (
    <div className="bg-blue-950/60 border border-blue-800 rounded-xl p-4 text-center space-y-2">
      <div className="flex items-center justify-center gap-2 mb-1">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-900 text-blue-300 border border-blue-700">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" aria-hidden="true" />
          Scheduled
        </span>
      </div>
      <p className="text-gray-400 text-xs">Stream starts in</p>
      <div
        className="flex items-center justify-center gap-3 font-mono"
        role="timer"
        aria-label="Time until stream starts"
      >
        {parts.map((p) => (
          <span key={p.label} className="flex flex-col items-center">
            <span className="text-2xl sm:text-3xl font-bold tabular-nums text-blue-300">
              {String(p.value).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">{p.label}</span>
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {new Date(scheduledStartTime * 1000).toLocaleString()}
      </p>
    </div>
  );
}

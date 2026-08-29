"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "@/src/lib/i18n";

interface PollingIndicatorProps {
  lastRefreshTime: number | null;
  isLoading?: boolean;
  onManualRefresh?: () => void;
  pollIntervalMs?: number;
}

export default function PollingIndicator({
  lastRefreshTime,
  isLoading = false,
  onManualRefresh,
  pollIntervalMs = 30000,
}: PollingIndicatorProps) {
  const t = useTranslations("dashboard");
  const [secondsUntilNext, setSecondsUntilNext] = useState(0);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!lastRefreshTime) {
      setSecondsUntilNext(0);
      return;
    }

    const timeUntilNext = Math.max(
      0,
      Math.ceil((pollIntervalMs - (now - lastRefreshTime)) / 1000)
    );
    setSecondsUntilNext(timeUntilNext);
  }, [now, lastRefreshTime, pollIntervalMs]);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
      {lastRefreshTime && (
        <>
          <span className="hidden sm:inline" title={new Date(lastRefreshTime).toLocaleString()}>
            Last update: {formatTime(lastRefreshTime)}
          </span>
          <span className="text-gray-400 dark:text-gray-500 hidden sm:inline">•</span>
          <span className="flex items-center gap-1" title={`Next automatic refresh in ${secondsUntilNext} seconds`}>
            <span className={`inline-block w-2 h-2 rounded-full ${
              isLoading ? "bg-yellow-400 animate-pulse" : "bg-green-400"
            }`} aria-hidden="true" />
            Next in {secondsUntilNext}s
          </span>
        </>
      )}
      {onManualRefresh && (
        <button
          onClick={onManualRefresh}
          disabled={isLoading}
          className="ml-1 px-2 py-1 rounded text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          aria-label={t("manual_refresh") || "Refresh now"}
          title={t("manual_refresh") || "Refresh now"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isLoading ? "animate-spin" : ""}
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      )}
    </div>
  );
}

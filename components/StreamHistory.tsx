"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatUSDC, truncateAddress } from "@/src/lib/sorostream";
import { useSettings } from "@/src/context/SettingsContext";
import { useNetwork } from "@/src/lib/network";
import { useTranslations } from "@/src/lib/i18n";
import { formatDateWithTimezone, formatDateUtc } from "@/src/lib/timezone";
import { downloadCSVStreaming } from "@/src/lib/export";

const PAGE_SIZE = 20;

export interface HistoryEntry {
  timestamp: string;
  type: "withdrawal" | "top-up" | "creation" | "cancellation";
  amount: string;
  txHash: string;
}

interface StreamHistoryProps {
  entries: HistoryEntry[];
  loading?: boolean;
  /** Stream ID used to name the downloaded CSV file (#522). */
  streamId?: string;
}

const typeConfig: Record<
  HistoryEntry["type"],
  { labelKey: "history_created" | "history_withdrawal" | "history_top_up" | "history_cancelled"; icon: string; colorClass: string }
> = {
  creation: { labelKey: "history_created", icon: "◉", colorClass: "text-gray-400 bg-gray-800" },
  withdrawal: {
    labelKey: "history_withdrawal",
    icon: "↓",
    colorClass: "text-green-400 bg-green-900/30",
  },
  "top-up": { labelKey: "history_top_up", icon: "↑", colorClass: "text-blue-400 bg-blue-900/30" },
  cancellation: {
    labelKey: "history_cancelled",
    icon: "✕",
    colorClass: "text-red-400 bg-red-900/30",
  },
};

function formatDate(value: string, language: string): string {
  return formatDateWithTimezone(value, language);
}

export default function StreamHistory({ entries, loading, streamId = "stream" }: StreamHistoryProps) {
  const t = useTranslations("common");
  const { network } = useNetwork();

  const explorerUrl = (txHash: string) =>
    `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** CSV export state (#522) */
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  let language = "en";
  try {
    const settings = useSettings();
    if (settings) language = settings.language;
  } catch {
    // fallback to "en" when context is not available (e.g. in tests)
  }

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [entries]);

  const loadMore = useCallback(() => {
    if (loadingMore || visibleCount >= entries.length) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, entries.length));
      setLoadingMore(false);
    }, 300);
  }, [loadingMore, visibleCount, entries.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= entries.length) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, visibleCount, entries.length]);

  /**
   * Export history as CSV using chunk-based streaming generation to avoid
   * blocking the main thread on large datasets (#522).
   */
  const handleExportCsv = useCallback(async () => {
    if (exporting || entries.length === 0) return;
    setExporting(true);
    setExportProgress(0);

    // Yield to the browser so the button can repaint to "Exporting…" state.
    await new Promise((r) => setTimeout(r, 0));

    try {
      const CHUNK = 100;
      const total = entries.length;
      // Pre-validate and exclude mock entries (isMock flag from StreamHistoryEntry).
      const realEntries = entries.filter((e) => !(e as any).isMock);

      // Build CSV in chunks, updating progress between each chunk.
      const header = "date,type,amount,token,transaction_id\n";
      const chunks: string[] = [header];

      for (let i = 0; i < realEntries.length; i += CHUNK) {
        const slice = realEntries.slice(i, i + CHUNK);
        const rows = slice
          .map((e) => {
            const date = new Date(e.timestamp).toLocaleString();
            const amount = (Number(e.amount) / 10_000_000).toFixed(2);
            // Escape CSV cells that might contain commas
            const escapedDate = date.includes(",") ? `"${date}"` : date;
            return `${escapedDate},${e.type},${amount},USDC,${e.txHash}`;
          })
          .join("\n");
        chunks.push(rows + "\n");
        setExportProgress(Math.min(1, (i + CHUNK) / Math.max(1, total)));
        // Yield to the browser between chunks so progress can paint.
        await new Promise((r) => setTimeout(r, 0));
      }

      setExportProgress(1);

      // Use Blob streaming: create blob from chunks array (avoids one big string concat).
      const blob = new Blob(chunks, { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split("T")[0];
      const filename = `stream-${streamId}-history-${date}.csv`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }, [entries, exporting, streamId]);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("loading_history")}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-gray-700" />
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-gray-700 rounded" />
                  <div className="h-3 w-32 bg-gray-700 rounded" />
                </div>
              </div>
              <div className="h-4 w-16 bg-gray-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700">
        <p className="text-gray-400">{t("no_history_events")}</p>
      </div>
    );
  }

  const visibleEntries = entries.slice(0, visibleCount);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-400 px-1 mb-1">
        <span>
          Total Events{" "}
          <span className="font-semibold text-gray-300">{entries.length}</span>
        </span>

        {/* CSV export button (#522) */}
        <button
          type="button"
          onClick={() => void handleExportCsv()}
          disabled={exporting || entries.length === 0}
          aria-busy={exporting}
          aria-label={`Export ${entries.length} history event${entries.length === 1 ? "" : "s"} as CSV`}
          className="relative overflow-hidden inline-flex items-center gap-1.5 bg-green-700 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {exporting && (
            <span
              className="absolute inset-0 bg-green-500/30 transition-[width] duration-100"
              style={{ width: `${Math.round(exportProgress * 100)}%` }}
              aria-hidden="true"
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {exporting ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {entries.length > 200
                  ? `Exporting… ${Math.round(exportProgress * 100)}%`
                  : "Exporting…"}
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export CSV
              </>
            )}
          </span>
        </button>
      </div>

      {visibleEntries.map((entry, idx) => {
        const config = typeConfig[entry.type] ?? typeConfig.creation;
        return (
          <div
            key={`${entry.txHash}-${idx}`}
            className={`rounded-lg p-4 border ${config.colorClass}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-sm">
                  {config.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{t(config.labelKey)}</p>
                  <p className="text-xs text-gray-400" title={formatDateUtc(entry.timestamp)}>
                    {formatDate(entry.timestamp, language)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">
                  {entry.type === "creation"
                    ? formatUSDC(BigInt(entry.amount))
                    : `${entry.type === "top-up" ? "+" : "-"}${formatUSDC(BigInt(entry.amount))}`}
                </p>
                <p className="text-xs text-gray-400 font-mono">
                  <a
                    href={explorerUrl(entry.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-green-400 underline decoration-dotted"
                    title="View transaction on Stellar Expert"
                  >
                    {truncateAddress(entry.txHash)}
                  </a>
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {visibleCount < entries.length && (
        /* Sentinel element: IntersectionObserver triggers the next page load
           automatically as the user scrolls to the bottom. No manual button. */
        <div
          ref={sentinelRef}
          aria-live="polite"
          aria-label="Loading more history events"
          className="py-4 text-center"
        >
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
              <svg
                className="animate-spin h-4 w-4 text-green-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Loading more events…</span>
            </div>
          )}
        </div>
      )}

      {visibleCount >= entries.length && entries.length > 0 && (
        <p className="text-center text-xs text-gray-500 py-3 italic">
          You have reached the end of history events
        </p>
      )}
    </div>
  );
}
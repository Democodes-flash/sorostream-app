"use client";

import { formatUSDC, truncateAddress } from "@/src/lib/sorostream";
import { useNetwork } from "@/src/lib/network";
import { useTranslations } from "@/src/lib/i18n";
import { formatDateUtc } from "@/src/lib/timezone";

export interface TimelineEntry {
  timestamp: string;
  type: "withdrawal" | "top-up" | "creation" | "cancellation" | "pause" | "resume";
  amount: string;
  txHash: string;
}

interface TransactionTimelineProps {
  entries: TimelineEntry[];
}

const typeConfig: Record<
  TimelineEntry["type"],
  {
    icon: string;
    color: string;
    bgColor: string;
    label: string;
  }
> = {
  creation: {
    icon: "📝",
    color: "text-gray-400",
    bgColor: "bg-gray-800",
    label: "Stream Created",
  },
  withdrawal: {
    icon: "💰",
    color: "text-green-400",
    bgColor: "bg-green-900/30",
    label: "Withdrawn",
  },
  "top-up": {
    icon: "⬆️",
    color: "text-blue-400",
    bgColor: "bg-blue-900/30",
    label: "Top-up",
  },
  cancellation: {
    icon: "❌",
    color: "text-red-400",
    bgColor: "bg-red-900/30",
    label: "Cancelled",
  },
  pause: {
    icon: "⏸️",
    color: "text-yellow-400",
    bgColor: "bg-yellow-900/30",
    label: "Paused",
  },
  resume: {
    icon: "▶️",
    color: "text-green-400",
    bgColor: "bg-green-900/30",
    label: "Resumed",
  },
};

export default function TransactionTimeline({ entries }: TransactionTimelineProps) {
  const t = useTranslations("common");
  const { network } = useNetwork();

  const getExplorerUrl = (txHash: string): string => {
    if (network === "public") {
      return `https://stellar.expert/explorer/public/tx/${txHash}`;
    }
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  };

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p className="text-sm">No transaction history available yet</p>
      </div>
    );
  }

  // Sort entries by timestamp in descending order (most recent first)
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="relative">
      {/* Timeline container */}
      <div className="space-y-4">
        {sortedEntries.map((entry, index) => {
          const config = typeConfig[entry.type];
          const isLast = index === sortedEntries.length - 1;

          return (
            <div
              key={`${entry.timestamp}-${entry.txHash}`}
              className="flex gap-4"
            >
              {/* Timeline dot and line */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${config.bgColor} border-2 ${config.color.replace("text-", "border-")}`}
                  role="img"
                  aria-label={config.label}
                >
                  {config.icon}
                </div>
                {!isLast && (
                  <div className="w-0.5 h-12 bg-gray-700 mt-2" aria-hidden="true" />
                )}
              </div>

              {/* Timeline content */}
              <div className="flex-1 pt-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-white text-sm">
                      {config.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateUtc(entry.timestamp, "en")}
                    </p>
                  </div>
                  {entry.amount && (
                    <div className="text-right">
                      <p className={`font-mono text-sm ${config.color}`}>
                        {entry.type === "withdrawal" ? "-" : "+"}
                        {formatUSDC(Number(entry.amount))}
                      </p>
                    </div>
                  )}
                </div>

                {/* Transaction hash link */}
                <div className="mt-2">
                  <a
                    href={getExplorerUrl(entry.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded px-1"
                    aria-label={`View transaction ${truncateAddress(entry.txHash)} on explorer`}
                  >
                    <span>{truncateAddress(entry.txHash, 8, 4)}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

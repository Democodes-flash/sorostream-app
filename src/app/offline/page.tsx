"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type StreamData, getStreamsForWallet } from "@/src/lib/sorostream";
import { useWallet } from "@/src/context/WalletContext";
import StreamCard from "@/components/StreamCard";

export default function OfflinePage() {
  const { address } = useWallet();
  const [cachedStreams, setCachedStreams] = useState<StreamData[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Attempt to load cached streams for the connected wallet or general storage
    try {
      const streams = getStreamsForWallet(address || "");
      if (streams && streams.length > 0) {
        setCachedStreams(streams);
      }
    } catch {
      // Fallback
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [address]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 flex flex-col items-center justify-start"
      data-testid="offline-fallback-page"
    >
      <div className="max-w-3xl w-full mx-auto space-y-6 pt-8">
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8 text-center space-y-4 shadow-xl">
          {/* Offline icon */}
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-900/40 border border-amber-700/60 flex items-center justify-center text-amber-400">
            <svg
              className="w-8 h-8"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L3 3m15.364 2.636a9 9 0 00-12.728 0M3 3l18 18M9.172 9.172a4 4 0 015.656 0m0 0l-2.828 2.828"
              />
            </svg>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-white">You&apos;re Offline</h1>
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              No internet connection detected. SoroStream is showing cached stream
              data saved on your device.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              <svg
                className="w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Retry Connection
            </button>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 border border-gray-700 text-gray-300 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Cached Stream Data Section */}
        <section aria-label="Cached stream data" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Cached Streams ({cachedStreams.length})
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
              Offline Cache
            </span>
          </div>

          {cachedStreams.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
              {cachedStreams.map((stream) => (
                <div key={stream.id} className="relative">
                  <StreamCard
                    id={stream.id}
                    sender={stream.sender}
                    recipient={stream.recipient}
                    flowRate={stream.flowRate}
                    deposit={stream.deposit}
                    status={stream.status}
                    scheduledStartTime={stream.scheduledStartTime}
                    startTime={stream.startTime}
                    endTime={stream.endTime}
                    token={stream.token}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-8 text-center text-gray-400 text-sm">
              No cached streams available for offline view. Reconnect to sync your streams.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import LiveCounter from "@/components/LiveCounter";
import FiatDisplay from "@/components/FiatDisplay";
import FederationName from "@/components/FederationName";
import StreamTimeline from "@/components/StreamTimeline";
import CountdownTimer from "@/components/CountdownTimer";
import StreamProgressBar from "@/components/StreamProgressBar";
import VestingChart from "@/components/VestingChart";
import { StreamErrorBoundary } from "@/components/StreamErrorBoundary";
import StreamCompletedBanner from "@/components/StreamCompletedBanner";
import { SkeletonDetail } from "@/components/Skeleton";
import StreamShareButtons from "@/components/StreamShareButtons";
import { type StreamData, getMockStream, claimableNow, getStreamMemo, formatStellarAmount, sorostream } from "@/src/lib/sorostream";
import { useSettings } from "@/src/context/SettingsContext";
import { useTranslations } from "@/src/lib/i18n";

/** Stream ID validation regex */
const STREAM_ID_REGEX = /^[\w-]{1,32}$/;

function isValidStreamId(id: string): boolean {
  return STREAM_ID_REGEX.test(id);
}

export default function PublicStreamViewerPage() {
  const t = useTranslations("stream_detail");
  const params = useParams();
  const { showUsd, language } = useSettings();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Update current time for live counters
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch stream data
  useEffect(() => {
    if (!id || !isValidStreamId(id)) {
      setError("Invalid stream ID");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchStream = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await Promise.race([
          sorostream.getStream(id),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Request timeout")), 10000)
          ),
        ]);

        if (!cancelled) {
          setStream(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stream");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchStream();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const streamStarted = stream && now >= new Date(stream.startTime).getTime();
  const streamEnded = stream && now >= new Date(stream.endTime).getTime();
  const claimable = stream ? claimableNow(stream, now) : 0;
  const claimableFormatted = stream ? formatStellarAmount(claimable, stream.decimals) : "0";

  const timelineData = useMemo(() => {
    if (!stream) return null;
    const startTime = new Date(stream.startTime).getTime();
    const endTime = new Date(stream.endTime).getTime();
    const cliffTime = stream.cliffTime ? new Date(stream.cliffTime).getTime() : null;

    return {
      startTime,
      endTime,
      cliffTime,
      currentTime: now,
      vestingData: stream.vestingData || [],
    };
  }, [stream, now]);

  if (loading) {
    return (
      <main id="main-content" className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <SkeletonDetail />
        </div>
      </main>
    );
  }

  if (error || !stream) {
    return (
      <main id="main-content" className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <h1 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">
              {error || "Stream not found"}
            </h1>
            <p className="text-red-700 dark:text-red-300 mb-4">
              The stream you're looking for doesn't exist or could not be loaded.
            </p>
            <Link href="/" className="inline-block bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors">
              Return Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const memo = getStreamMemo(stream);
  const giftMessage = memo && memo.startsWith("GIFT:") ? memo.slice(5) : null;

  return (
    <main id="main-content" className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Stream Details
              </h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                streamEnded
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  : "bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200"
              }`}>
                {streamEnded ? "Ended" : "Active"}
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Public stream viewer (read-only)</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-400">Stream ID</p>
            <code className="text-xs font-mono text-gray-900 dark:text-white break-all">{stream.id}</code>
          </div>
        </div>

        {/* Share buttons */}
        <div className="mb-6">
          <StreamShareButtons streamId={stream.id} isPublicView={true} />
        </div>

        {/* Completion banner */}
        {streamEnded && <StreamCompletedBanner stream={stream} />}

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Stream info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Sender and Recipient */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    From
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {stream.sender.slice(0, 10)}…{stream.sender.slice(-8)}
                    </code>
                    <FederationName address={stream.sender} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    To
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {stream.recipient.slice(0, 10)}…{stream.recipient.slice(-8)}
                    </code>
                    <FederationName address={stream.recipient} />
                  </div>
                </div>
              </div>
            </div>

            {/* Gift message if present */}
            {giftMessage && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <span className="font-semibold">Gift message:</span> {giftMessage}
                </p>
              </div>
            )}

            {/* Amount and token info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    Total Amount
                  </p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {formatStellarAmount(stream.deposit, stream.decimals)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {stream.token}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    Claimed
                  </p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    {formatStellarAmount(stream.claimed, stream.decimals)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    Claimable Now
                  </p>
                  <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                    {claimableFormatted}
                  </p>
                </div>
              </div>
              {showUsd && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Total (USD)</p>
                      <FiatDisplay amount={formatStellarAmount(stream.deposit, stream.decimals)} token={stream.token} className="text-lg font-bold" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Claimed (USD)</p>
                      <FiatDisplay amount={formatStellarAmount(stream.claimed, stream.decimals)} token={stream.token} className="text-lg font-bold text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Claimable (USD)</p>
                      <FiatDisplay amount={claimableFormatted} token={stream.token} className="text-lg font-bold text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <StreamErrorBoundary section="Progress Bar">
              <StreamProgressBar stream={stream} currentTime={now} />
            </StreamErrorBoundary>

            {/* Timeline */}
            {timelineData && (
              <StreamErrorBoundary section="Timeline">
                <StreamTimeline data={timelineData} />
              </StreamErrorBoundary>
            )}

            {/* Vesting Chart */}
            {stream.vestingData && stream.vestingData.length > 0 && (
              <StreamErrorBoundary section="Vesting Chart">
                <VestingChart stream={stream} currentTime={now} />
              </StreamErrorBoundary>
            )}
          </div>

          {/* Right column: Info cards */}
          <div className="space-y-4">
            {/* Duration */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Duration
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {Math.round(
                  (new Date(stream.endTime).getTime() - new Date(stream.startTime).getTime()) / 1000 / 86400
                )}{" "}
                days
              </p>
            </div>

            {/* Start time */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Start Time
              </p>
              <p className="text-sm font-mono text-gray-900 dark:text-white">
                {new Date(stream.startTime).toLocaleString(language)}
              </p>
              {!streamStarted && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                  Starts in <CountdownTimer targetTime={new Date(stream.startTime).getTime()} />
                </p>
              )}
            </div>

            {/* End time */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                End Time
              </p>
              <p className="text-sm font-mono text-gray-900 dark:text-white">
                {new Date(stream.endTime).toLocaleString(language)}
              </p>
              {!streamEnded && streamStarted && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  Ends in <CountdownTimer targetTime={new Date(stream.endTime).getTime()} />
                </p>
              )}
            </div>

            {/* Remaining amount */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Remaining
              </p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {formatStellarAmount(
                  stream.deposit - stream.claimed,
                  stream.decimals
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {((100 * (stream.deposit - stream.claimed)) / stream.deposit).toFixed(1)}% of total
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            This is a public, read-only view of the stream. Only the stream recipient can claim funds.
          </p>
          <Link
            href="/"
            className="inline-block text-green-600 dark:text-green-400 hover:underline text-sm"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

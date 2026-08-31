import type { StreamHistoryEntry } from "./export";
import { dispatchWebhook } from "./webhooks";

export interface StreamData {
  id: string;
  sender: string;
  recipient: string;
  token: string;
  flowRate: number;
  deposit: number;
  startTime: string;
  endTime: string;
  lastWithdrawTime: string;
  status: "Active" | "Cancelled" | "Ended" | "Paused";
  /** ISO timestamp captured when the stream was paused. Frozen balances use this. */
  pausedAt?: string;
  /** Unix timestamp (seconds) when the stream was cancelled. Set on cancel. */
  cancelledAt?: number;
  /** Unix timestamp (seconds) when the stream is scheduled to auto-pause. */
  pauseAt?: number;
  /** Whether the stream auto-renews on expiry. */
  autoRenew?: boolean;
  /** Duration in seconds for each auto-renewal cycle (defaults to original duration). */
  autoRenewDurationSeconds?: number;
  /** Unix timestamp (seconds). When set and > now, stream is scheduled. */
  scheduledStartTime?: number;
  /** Optional metadata URI (ipfs://, https://, or ar://) pointing to stream metadata. */
  metadataUri?: string;
  /** Optional short plaintext memo attached at creation time. */
  memo?: string;
}

/**
 * Returns the plaintext memo for a stream, reading it from the dedicated
 * field or decoding it out of the stream's metadata URI (`?memo=` / `#memo=`).
 */
export function getStreamMemo(stream: StreamData): string | undefined {
  if (stream.memo) return stream.memo;
  if (!stream.metadataUri) return undefined;
  try {
    const uri = new URL(stream.metadataUri);
    const fromQuery = uri.searchParams.get("memo");
    if (fromQuery) return decodeURIComponent(fromQuery);
    if (uri.hash.startsWith("#memo=")) return decodeURIComponent(uri.hash.slice("#memo=".length));
    return undefined;
  } catch {
    return undefined;
  }
}

// ── Protocol stats ───────────────────────────────────────────────────────────

export interface ProtocolStats {
  tvlStroops: number;
  activeStreams: number;
  totalStreams: number;
  totalWithdrawnStroops: number;
  uniqueSenders: number;
  uniqueRecipients: number;
  /** ISO timestamps for sparkline history (last 10 data points) */
  tvlHistory: number[];
  activeStreamsHistory: number[];
}

/** Simulates reading protocol-wide stats from the contract / indexer. */
export async function getProtocolStats(): Promise<ProtocolStats> {
  const now = Date.now();
  // Build a realistic mock sparkline (10 points over the last hour)
  const tvlHistory = Array.from({ length: 10 }, (_, i) => {
    const base = 45_000_000_000_000; // ~4.5M USDC in stroops
    return base + Math.round(Math.sin(i * 0.7) * 2_000_000_000_000 + i * 500_000_000_000);
  });
  const activeStreamsHistory = Array.from({ length: 10 }, (_, i) =>
    Math.max(1, 3 + Math.round(Math.sin(i * 0.5) * 1)),
  );
  void now;
  return {
    tvlStroops: 47_500_000_000_000,       // 4,750,000 USDC
    activeStreams: MOCK_STREAMS.filter((s) => s.status === "Active").length,
    totalStreams: MOCK_STREAMS.length,
    totalWithdrawnStroops: 8_200_000_000_000,
    uniqueSenders: 4,
    uniqueRecipients: 6,
    tvlHistory,
    activeStreamsHistory,
  };
}

export interface VolumePoint {
  date: string;
  usdc: number;
  xlm: number;
}

export interface TopRecipient {
  recipient: string;
  totalStroops: number;
}

export interface AssetSlice {
  asset: string;
  valueStroops: number;
}

export interface StreamAnalytics {
  volumeOverTime: VolumePoint[];
  topRecipients: TopRecipient[];
  assetBreakdown: AssetSlice[];
  totalValueStroops: number;
}

/**
 * Compute stream analytics for the dedicated analytics dashboard, derived from
 * the in-memory stream store today; in production this would aggregate
 * on-chain history / an indexer.
 *
 * @param windowDays  Number of trailing days to bucket volume into (default 14).
 */
export function getStreamAnalytics(windowDays = 14): StreamAnalytics {
  const now = Date.now();
  const cutoff = now - windowDays * 86_400_000;

  const buckets = new Map<number, VolumePoint>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const dayStart = new Date(now - i * 86_400_000);
    dayStart.setHours(0, 0, 0, 0);
    const key = dayStart.getTime();
    const label = `${String(dayStart.getMonth() + 1).padStart(2, "0")}/${String(
      dayStart.getDate(),
    ).padStart(2, "0")}`;
    buckets.set(key, { date: label, usdc: 0, xlm: 0 });
  }

  const recipients = new Map<string, number>();
  const assets = new Map<string, number>();
  let totalValueStroops = 0;

  for (const stream of MOCK_STREAMS) {
    const start = new Date(stream.startTime).getTime();
    const key = new Date(start).setHours(0, 0, 0, 0);
    const bucket = buckets.get(key);
    if (bucket) {
      if (stream.token === "XLM") bucket.xlm += stream.deposit;
      else bucket.usdc += stream.deposit;
    }

    if (start >= cutoff) {
      recipients.set(
        stream.recipient,
        (recipients.get(stream.recipient) ?? 0) + stream.deposit,
      );
      assets.set(
        stream.token,
        (assets.get(stream.token) ?? 0) + stream.deposit,
      );
      totalValueStroops += stream.deposit;
    }
  }

  const volumeOverTime = Array.from(buckets.values());
  const topRecipients = Array.from(recipients.entries())
    .map(([recipient, totalStroops]) => ({ recipient, totalStroops }))
    .sort((a, b) => b.totalStroops - a.totalStroops)
    .slice(0, 6);
  const assetBreakdown = Array.from(assets.entries())
    .map(([asset, valueStroops]) => ({ asset, valueStroops }))
    .sort((a, b) => b.valueStroops - a.valueStroops);

  return { volumeOverTime, topRecipients, assetBreakdown, totalValueStroops };
}

// ── Fee simulation ────────────────────────────────────────────────────────────

export interface FeeEstimate {
  inclusionFeeLumens: string;
  resourceFeeLumens: string;
  totalFeeLumens: string;
}

/**
 * Simulates a Soroban RPC `simulateTransaction` call to estimate fees.
 * In production this would call `server.simulateTransaction(tx)`.
 */
export async function simulateTransactionFee(): Promise<FeeEstimate> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
  // Mock Soroban fee breakdown (realistic testnet values)
  const inclusionFee = 0.00001 + Math.random() * 0.00002;
  const resourceFee = 0.00005 + Math.random() * 0.0001;
  const total = inclusionFee + resourceFee;
  const fmt = (n: number) => n.toFixed(7);
  return {
    inclusionFeeLumens: fmt(inclusionFee),
    resourceFeeLumens: fmt(resourceFee),
    totalFeeLumens: fmt(total),
  };
}

export interface TvlStreamLike {
  deposit: number;
  status: StreamData["status"];
  /**
   * Optional amount already withdrawn from the stream, in stroops.
   * This lets unit tests model partial withdrawals without changing the
   * existing stream shape everywhere else in the app.
   */
  withdrawnStroops?: number;
}

/**
 * Calculate the total value locked from active streams only.
 * Cancelled and ended streams are excluded entirely.
 */
export function calculateTotalValueLocked(streams: TvlStreamLike[]): number {
  return streams.reduce((total, stream) => {
    if (stream.status !== "Active") return total;

    const deposit = Number.isFinite(stream.deposit) ? Math.max(0, stream.deposit) : 0;
    const withdrawn = Number.isFinite(stream.withdrawnStroops ?? 0)
      ? Math.max(0, stream.withdrawnStroops ?? 0)
      : 0;

    return total + Math.max(0, deposit - withdrawn);
  }, 0);
}

export interface CompletionTimeInput {
  /** Stream start time (ISO string or Date). */
  startTime: string | Date;
  /** Flow rate in stroops per second. */
  flowRate: number;
  /** Total deposit (fixed stream amount) in stroops. */
  deposit: number;
}

/**
 * Estimate when a stream will be fully dripped (#415).
 *
 * For streams with a fixed total amount, the completion instant is
 * `startTime + deposit / flowRate` — independent of the configured endTime,
 * so it stays correct after top-ups extend the total.
 *
 * Returns `null` when the estimate cannot be computed (zero/negative rate or
 * deposit, or an unparseable start time).
 */
export function estimateStreamCompletionTime({
  startTime,
  flowRate,
  deposit,
}: CompletionTimeInput): Date | null {
  const rate = Number(flowRate);
  const total = Number(deposit);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;

  const startMs =
    typeof startTime === "string" ? new Date(startTime).getTime() : startTime.getTime();
  if (!Number.isFinite(startMs)) return null;

  const durationSeconds = total / rate;
  return new Date(startMs + durationSeconds * 1000);
}

/**
 * Human-readable relative time until the given date ("in 3d 4h", "in 45m").
 * Past dates return "completed". Used next to the estimated completion time.
 */
export function formatTimeUntil(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "completed";

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
  if (hours > 0) return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  return `in ${Math.max(1, minutes)}m`;
}

/** Mutable stream store — seeded with test data, extended by createStream(). */
const MOCK_STREAMS: StreamData[] = [
  {
    id: "1", sender: "GBAM...BOEP", recipient: "GBCR...XDRL", token: "USDC",
    flowRate: 1000000, deposit: 10000000000,
    startTime: new Date(Date.now() - 86400000 * 3).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 7).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000).toISOString(),
    status: "Active",
  },
  {
    id: "2", sender: "GBAM...BOEP", recipient: "GDEF...XYZ", token: "USDC",
    flowRate: 500000, deposit: 5000000000,
    startTime: new Date(Date.now() - 86400000 * 10).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 5).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 2).toISOString(),
    status: "Active",
  },
  {
    id: "3", sender: "GHIJ...KLMN", recipient: "GBAM...BOEP", token: "XLM",
    flowRate: 2000000, deposit: 20000000000,
    startTime: new Date(Date.now() - 86400000 * 1).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 14).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000).toISOString(),
    status: "Active",
  },
  {
    id: "4", sender: "GBAM...BOEP", recipient: "GXYZ...ABC", token: "USDC",
    flowRate: 750000, deposit: 7500000000,
    startTime: new Date(Date.now() - 86400000 * 5).toISOString(),
    endTime: new Date(Date.now() - 86400000 * 1).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 2).toISOString(),
    status: "Ended",
  },
  {
    id: "5", sender: "GDEF...XYZ", recipient: "GHIJ...KLMN", token: "XLM",
    flowRate: 300000, deposit: 3000000000,
    startTime: new Date(Date.now() - 86400000 * 2).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 3).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 1).toISOString(),
    status: "Cancelled",
  },
  {
    id: "9", sender: "GBAM...BOEP", recipient: "GSCH...DULD", token: "USDC",
    flowRate: 600000, deposit: 6000000000,
    startTime: new Date(Date.now() + 86400000 * 2).toISOString(),
    endTime: new Date(Date.now() + 86400000 * 12).toISOString(),
    lastWithdrawTime: new Date(Date.now() + 86400000 * 2).toISOString(),
    status: "Active",
    scheduledStartTime: Math.floor((Date.now() + 86400000 * 2) / 1000),
  },
  // --- Archived streams (ended/cancelled > 30 days ago) ---
  {
    id: "6", sender: "GBAM...BOEP", recipient: "GARC...H1VE", token: "USDC",
    flowRate: 200000, deposit: 2000000000,
    startTime: new Date(Date.now() - 86400000 * 90).toISOString(),
    endTime: new Date(Date.now() - 86400000 * 60).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 61).toISOString(),
    status: "Ended",
  },
  {
    id: "7", sender: "GHIJ...KLMN", recipient: "GBAM...BOEP", token: "XLM",
    flowRate: 150000, deposit: 1500000000,
    startTime: new Date(Date.now() - 86400000 * 120).toISOString(),
    endTime: new Date(Date.now() - 86400000 * 45).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 46).toISOString(),
    status: "Cancelled",
  },
  {
    id: "8", sender: "GXYZ...ABC", recipient: "GDEF...XYZ", token: "USDC",
    flowRate: 400000, deposit: 4000000000,
    startTime: new Date(Date.now() - 86400000 * 180).toISOString(),
    endTime: new Date(Date.now() - 86400000 * 31).toISOString(),
    lastWithdrawTime: new Date(Date.now() - 86400000 * 32).toISOString(),
    status: "Ended",
  },
];

let nextId = 6;

/**
 * Validates an optional metadata URI.
 * Accepts ipfs://, https://, and ar:// schemes.
 * Returns an error string if invalid, or empty string if valid.
 */
export function validateMetadataUri(value: string): string {
  if (!value) return ""; // Empty is allowed (optional field)
  
  try {
    const url = new URL(value);
    const scheme = url.protocol.replace(":", "");
    
    const allowedSchemes = ["ipfs", "https", "ar"];
    if (!allowedSchemes.includes(scheme)) {
      return `Must use one of: ipfs://, https://, or ar://`;
    }
    
    return "";
  } catch {
    return "Invalid URI format.";
  }
}

export interface CreateStreamParams {
  recipient?: string;
  amount?: string;
  durationSeconds?: number;
  token?: string;
  /** Pass true to enable auto_renew on the contract. */
  autoRenew?: boolean;
  /** Duration in seconds for each renewal cycle; defaults to durationSeconds. */
  autoRenewDurationSeconds?: number;
  /** Unix timestamp (seconds) for a scheduled start. Omit or set to 0 for immediate start. */
  scheduledStartTime?: number;
  /** Optional metadata URI (ipfs://, https://, or ar://) pointing to stream metadata. */
  metadataUri?: string;
  /** Optional short plaintext memo; persisted inside the stream metadata URI. */
  memo?: string;
  /** When true, construct a fee-bump envelope using the configured fee sponsor account. */
  feeBump?: boolean;
  /** The fee sponsor's Stellar public key. Required when feeBump is true. */
  feeSponsorAddress?: string;
}

export function watchClaimable(streams: StreamData[]): StreamData[] {
  return streams.map((s) => ({
    ...s,
    lastWithdrawTime: new Date(
      new Date(s.lastWithdrawTime).getTime() + 1000
    ).toISOString(),
  }));
}

export function simulateNewEvent(): StreamEvent {
  const types: StreamEvent["type"][] = ["withdrawal", "top-up", "creation", "alert"];
  const type = types[Math.floor(Math.random() * types.length)];
  const streamId = String(Math.floor(Math.random() * 5) + 1);
  const asset = Math.random() < 0.5 ? "USDC" : "XLM";
  const amount = type !== "creation" && type !== "alert" ? String(Math.floor(Math.random() * 5000000000) + 1000000000) : undefined;
  const message = type === "alert" ? `Stream #${streamId} expires in 24 hours` : undefined;
  return addStreamEvent({
    type,
    streamId,
    amount,
    asset,
    message,
    timestamp: new Date().toISOString(),
    txHash: `0x${Math.random().toString(36).slice(2, 8)}`,
  });
}

export const sorostream = {
  createStream: async (params?: CreateStreamParams) => {
    const id = String(nextId++);
    const durationSeconds = params?.durationSeconds ?? 86400;
    const deposit = params?.amount
      ? Math.round(parseFloat(params.amount) * 10_000_000)
      : 0;
    const flowRate = durationSeconds > 0 ? Math.round(deposit / durationSeconds) : 0;
    const now = new Date();
    const scheduledStartTime = params?.scheduledStartTime && params.scheduledStartTime > Math.floor(Date.now() / 1000)
      ? params.scheduledStartTime
      : undefined;
    const startDate = scheduledStartTime ? new Date(scheduledStartTime * 1000) : now;
    // #408 — the memo travels inside the stream metadata URI; when the user
    // supplied their own URI we keep it untouched and store the memo alongside.
    const memo = params?.memo?.trim() || undefined;
    const metadataUri =
      memo && !params?.metadataUri
        ? `https://metadata.sorostream.app/streams/memo.json?memo=${encodeURIComponent(memo)}`
        : params?.metadataUri;
    const stream: StreamData = {
      id,
      sender: "GTEST...SENDER",
      recipient: params?.recipient ?? "GTEST...RECIP",
      token: params?.token ?? "USDC",
      flowRate,
      deposit,
      startTime: startDate.toISOString(),
      endTime: new Date(startDate.getTime() + durationSeconds * 1000).toISOString(),
      lastWithdrawTime: startDate.toISOString(),
      status: "Active",
      autoRenew: params?.autoRenew ?? false,
      autoRenewDurationSeconds: params?.autoRenew
        ? (params.autoRenewDurationSeconds ?? durationSeconds)
        : undefined,
      scheduledStartTime,
      metadataUri,
      memo,
    };
    MOCK_STREAMS.push(stream);
    void dispatchWebhook({
      type: "stream.created",
      streamId: id,
      timestamp: new Date().toISOString(),
      asset: stream.token,
      message: `Stream ${id} created for ${stream.recipient}`,
    });
    return { streamId: id, txHash: `mock-tx-${id}` };
  },
  withdraw: async (id?: string) => {
    if (id) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      void dispatchWebhook({
        type: "stream.withdrawn",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Withdrawal processed for stream ${id}`,
      });
    }
    return { txHash: "mock-tx-hash", amount: "0" };
  },
  cancelStream: async (id?: string) => {
    if (id) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      if (stream) stream.status = "Cancelled";
      void dispatchWebhook({
        type: "stream.cancelled",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Stream ${id} cancelled`,
      });
    }
    return { txHash: "mock-tx-hash" };
  },
  pauseStream: async (id?: string) => {
    if (id) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      if (stream && stream.status === "Active") stream.status = "Paused";
      void dispatchWebhook({
        type: "stream.paused",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Stream ${id} paused`,
      });
    }
    return { txHash: "mock-pause-tx-hash" };
  },
  resumeStream: async (id?: string) => {
    if (id) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      if (stream && stream.status === "Paused") stream.status = "Active";
      void dispatchWebhook({
        type: "stream.resumed",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Stream ${id} resumed`,
      });
    }
    return { txHash: "mock-resume-tx-hash" };
  },
  /** Schedule a stream to automatically pause at a future unix timestamp (seconds). */
  schedulePause: async (id?: string, pauseAt?: number) => {
    if (id && pauseAt) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      if (stream && stream.status === "Active") stream.pauseAt = pauseAt;
    }
    return { txHash: "mock-schedule-pause-tx-hash" };
  },
  transferRecipient: async (id?: string, newRecipient?: string) => {
    if (id && newRecipient) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      if (stream) stream.recipient = newRecipient;
      void dispatchWebhook({
        type: "stream.recipient_transferred",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Stream ${id} recipient changed to ${newRecipient}`,
      });
    }
    return { txHash: "mock-transfer-tx-hash" };
  },
  topUp: async (id?: string) => {
    if (id) {
      const stream = MOCK_STREAMS.find((s) => s.id === id);
      void dispatchWebhook({
        type: "stream.topped_up",
        streamId: id,
        timestamp: new Date().toISOString(),
        asset: stream?.token,
        message: `Stream ${id} topped up`,
      });
    }
    return { txHash: "", newEndTime: new Date() };
  },
  getStream: async (id: string) => getMockStream(id),
  getClaimable: async (streamId: string) => claimableNow(getMockStream(streamId)),
  getStreamsBySender: async () => { applyScheduledPauses(); return MOCK_STREAMS; },
  getStreamsByRecipient: async () => { applyScheduledPauses(); return MOCK_STREAMS; },
  getEvents: async () => getStreamEvents(),
  batchWithdraw: async (streamIds: string[]) => ({
    txHash: "mock-batch-tx-hash",
    amounts: Object.fromEntries(streamIds.map(id => [id, "0"])),
  }),
  /** Returns the deployed contract version string (e.g. "1.0.0"). */
  get_version: async (): Promise<string> => {
    // In production this would call the Soroban contract's get_version() method.
    // Return a simulated short delay to mimic real async fetch.
    await new Promise((r) => setTimeout(r, 200));
    return "1.0.0";
  },
  /** Batch-create multiple streams in a single transaction. */
  batch_create: async (streams: CreateStreamParams[]): Promise<{
    txHash: string;
    results: Array<{ index: number; streamId: string | null; error: string | null }>;
  }> => {
    // Simulate a short confirmation delay
    await new Promise((r) => setTimeout(r, 600));
    const results = await Promise.all(
      streams.map(async (params, index) => {
        try {
          const result = await sorostream.createStream(params);
          return { index, streamId: result.streamId, error: null };
        } catch (err) {
          return {
            index,
            streamId: null,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      }),
    );
    return { txHash: `mock-batch-tx-${Date.now()}`, results };
  },
};

export function getMockStream(id: string): StreamData | null {
  return MOCK_STREAMS.find(s => s.id === id) ?? null;
}

/**
 * Auto-pause any Active stream whose scheduled `pauseAt` timestamp has passed.
 * Mutates the in-memory store. Safe to call on every read.
 */
export function applyScheduledPauses(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const s of MOCK_STREAMS) {
    if (s.status === "Active" && s.pauseAt && s.pauseAt > 0 && s.pauseAt <= nowSec) {
      s.status = "Paused";
      s.pauseAt = undefined;
    }
  }
}

export function getMockStreams(): StreamData[] {
  return MOCK_STREAMS;
}

/** Archive threshold in milliseconds (30 days after end/cancel). */
const ARCHIVE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns streams that are eligible for the archive:
 * - status is "Ended" or "Cancelled"
 * - endTime was more than 30 days ago
 * Active streams are NEVER returned here.
 */
export function getArchivedStreams(): StreamData[] {
  const cutoff = Date.now() - ARCHIVE_THRESHOLD_MS;
  return MOCK_STREAMS.filter(
    (s) =>
      (s.status === "Ended" || s.status === "Cancelled") &&
      new Date(s.endTime).getTime() <= cutoff,
  );
}

/**
 * Returns non-archived streams: Active streams, or Ended/Cancelled streams
 * that ended within the last 30 days.
 */
export function getActiveDashboardStreams(): StreamData[] {
  const cutoff = Date.now() - ARCHIVE_THRESHOLD_MS;
  return MOCK_STREAMS.filter((s) => {
    if (s.status === "Active") return true;
    return new Date(s.endTime).getTime() > cutoff;
  });
}

/**
 * Return streams relevant to the given wallet address.
 * A stream is relevant when the address is the sender or recipient.
 * Falls back to returning all streams when address is null or empty.
 */
export function getStreamsForWallet(address: string | null): StreamData[] {
  if (!address) return MOCK_STREAMS;
  const relevant = MOCK_STREAMS.filter(
    (s) => s.sender.includes(address.slice(0, 5)) || s.recipient.includes(address.slice(0, 5)),
  );
  return relevant.length > 0 ? relevant : MOCK_STREAMS;
}

/**
 * Returns synthesised (non-on-chain) history entries for development and
 * demo purposes. Every entry is tagged `isMock: true` so callers can
 * suppress display or export of fabricated data. Do not present these
 * entries to users as real transaction records.
 */
export function getMockStreamHistory(id: string): StreamHistoryEntry[] {
  const base: StreamHistoryEntry[] = [
    { timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), type: "creation", amount: "10000000000", txHash: "0xabc123creation", isMock: true },
  ];
  if (id === "1" || id === "2" || id === "3") {
    base.push(
      { timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), type: "withdrawal", amount: "2500000000", txHash: "0xdef456withdraw", isMock: true },
      { timestamp: new Date(Date.now() - 86400000).toISOString(), type: "top-up", amount: "5000000000", txHash: "0xghi789topup", isMock: true },
    );
  }
  return base;
}

export const createClient = () => sorostream;

/**
 * Format a stroops value as XLM/USDC with full 7-decimal precision.
 * Uses locale-aware grouping so large values are readable, e.g. "1,234.5678900".
 * Small values like 0.0001234 are preserved rather than rounding to "0.00".
 */
export function formatUSDC(stroops: bigint): string {
  return formatStellarAmount(Number(stroops));
}

/**
 * Format a raw stroop number (integer, 7-decimal fixed-point) as a
 * locale-aware string with up to 7 significant decimal places.
 *
 * Examples:
 *   1234 stroops  → "0.0001234"
 *   10000000      → "1.0000000"
 *   10000000000   → "1,000.0000000"
 */
export function formatStellarAmount(stroops: number): string {
  const whole = stroops / 10_000_000;
  return whole.toLocaleString(undefined, {
    minimumFractionDigits: 7,
    maximumFractionDigits: 7,
  });
}

export function toStroops(usdc: string): bigint {
  return BigInt(Math.round(parseFloat(usdc) * 10000000));
}

export function calculateFlowRate(stroops: bigint, durationSeconds: number): bigint {
  if (durationSeconds === 0) return BigInt(0);
  return stroops / BigInt(durationSeconds);
}

export function claimableNow(stream: any): string {
  if (!stream) return "0";

  const flowRate = Number(stream.flowRate);
  const lastWithdrawTime = new Date(stream.lastWithdrawTime).getTime();

  if (!Number.isFinite(flowRate) || !Number.isFinite(lastWithdrawTime)) {
    return "0";
  }

  // When paused, freeze the elapsed window at the moment of pausing so the
  // streamed/claimable balance stops advancing.
  if (stream.status === "Paused" && stream.pausedAt) {
    const pausedAt = new Date(stream.pausedAt).getTime();
    const elapsedSeconds = Math.max(0, (pausedAt - lastWithdrawTime) / 1000);
    return Math.floor(flowRate * elapsedSeconds).toString();
  }

  // A cancelled or ended stream stops accruing once it can no longer drip.
  // Cap the effective "now" so the recipient can only claim what actually
  // streamed before the stream stopped.
  let effectiveNow = Date.now();
  if (stream.status === "Cancelled" && stream.cancelledAt) {
    effectiveNow = Math.min(effectiveNow, stream.cancelledAt * 1000);
  } else if (stream.status === "Ended") {
    effectiveNow = Math.min(effectiveNow, new Date(stream.endTime).getTime());
  }

  const elapsedSeconds = Math.max(0, (effectiveNow - lastWithdrawTime) / 1000);
  return Math.floor(flowRate * elapsedSeconds).toString();
}



/**
 * Total amount streamed so far from a stream's deposit, in stroops.
 *
 * - For active streams: `flowRate × elapsed_seconds_from_start`.
 * - For paused streams: frozen at the value held when pausing.
 * - For future streams (startTime > now): 0 — no drip has occurred yet.
 * - For ended/cancelled streams: capped at the moment the stream stopped.
 *
 * The return value is always a non-negative integer (floor, in stroops).
 */
export function getStreamedAmount(stream: any): number {
  if (!stream) return 0;

  const flowRate = Number(stream.flowRate);
  const startTime = new Date(stream.startTime).getTime();

  if (!Number.isFinite(flowRate) || !Number.isFinite(startTime)) return 0;

  // Clamp effective "now" to the stream start time so future streams show 0%.
  let effectiveNow = Math.max(Date.now(), startTime);

  // Paused: freeze at the moment the stream was paused.
  if (stream.status === "Paused" && stream.pausedAt) {
    const pausedAtMs = new Date(stream.pausedAt).getTime();
    const elapsedSeconds = Math.max(0, (pausedAtMs - startTime) / 1000);
    return Math.floor(flowRate * elapsedSeconds);
  }

  // Ended: cap at the configured end time.
  if (stream.status === "Ended") {
    effectiveNow = Math.min(effectiveNow, new Date(stream.endTime).getTime());
  }

  // Cancelled: cap at the cancellation timestamp when available.
  if (stream.status === "Cancelled" && stream.cancelledAt) {
    effectiveNow = Math.min(effectiveNow, stream.cancelledAt * 1000);
  }

  const elapsedSeconds = Math.max(0, (effectiveNow - startTime) / 1000);
  return Math.floor(flowRate * elapsedSeconds);
}

/**
 * Remaining (unstreamed) deposit in stroops. Freezes while the stream is
 * paused instead of continuing to count down.
 */
export function getRemainingBalance(stream: StreamData): number {
  if (!stream) return 0;
  const deposit = Number(stream.deposit);
  if (!Number.isFinite(deposit)) return 0;
  return Math.max(0, deposit - getStreamedAmount(stream));
}

/**
 * On-chain price oracle (simulated). Returns the USD price for a given token
 * asset code by reading a contract-style price feed. USD-pegged assets map to
 * 1; volatile assets (e.g. XLM) carry a snapshot price.
 */
const ORACLE_PRICES: Record<string, number> = {
  USDC: 1,
  USDA: 1,
  EURT: 1.08,
  YUSDC: 1,
  XLM: 0.12,
};

export async function getOraclePrice(token: string): Promise<number | null> {
  const key = (token || "").toUpperCase();
  if (key in ORACLE_PRICES) return ORACLE_PRICES[key];
  return null;
}

export interface StreamEvent {
  id: string;
  type: "withdrawal" | "top-up" | "creation" | "cancellation" | "alert";
  streamId: string;
  timestamp: string;
  amount?: string;
  txHash: string;
  /** Token/asset code this event relates to, e.g. "USDC" or "XLM". */
  asset?: string;
  /** Short human-readable detail, used mainly by "alert" events. */
  message?: string;
}

const MOCK_EVENTS: StreamEvent[] = [
  { id: "e1", type: "creation", streamId: "4", timestamp: new Date(Date.now() - 30000).toISOString(), txHash: "0xabc", asset: "USDC" },
  { id: "e2", type: "withdrawal", streamId: "1", timestamp: new Date(Date.now() - 120000).toISOString(), amount: "2500000000", txHash: "0xdef", asset: "USDC" },
  { id: "e3", type: "top-up", streamId: "2", timestamp: new Date(Date.now() - 300000).toISOString(), amount: "5000000000", txHash: "0xghi", asset: "USDC" },
  { id: "e4", type: "withdrawal", streamId: "3", timestamp: new Date(Date.now() - 600000).toISOString(), amount: "1000000000", txHash: "0xjkl", asset: "XLM" },
  { id: "e5", type: "creation", streamId: "5", timestamp: new Date(Date.now() - 900000).toISOString(), txHash: "0xmno", asset: "XLM" },
  { id: "e6", type: "alert", streamId: "4", timestamp: new Date(Date.now() - 1_500_000).toISOString(), txHash: "0xp01", asset: "USDC", message: "Stream #4 expires in 24 hours" },
  { id: "e7", type: "cancellation", streamId: "5", timestamp: new Date(Date.now() - 2_400_000).toISOString(), txHash: "0xq12", asset: "XLM" },
  { id: "e8", type: "withdrawal", streamId: "2", timestamp: new Date(Date.now() - 3_600_000).toISOString(), amount: "1800000000", txHash: "0xr23", asset: "USDC" },
  { id: "e9", type: "alert", streamId: "1", timestamp: new Date(Date.now() - 5_400_000).toISOString(), txHash: "0xs34", asset: "USDC", message: "Withdrawal available on Stream #1" },
  { id: "e10", type: "top-up", streamId: "3", timestamp: new Date(Date.now() - 7_200_000).toISOString(), amount: "3000000000", txHash: "0xt45", asset: "XLM" },
  { id: "e11", type: "creation", streamId: "2", timestamp: new Date(Date.now() - 9_000_000).toISOString(), txHash: "0xu56", asset: "USDC" },
  { id: "e12", type: "withdrawal", streamId: "4", timestamp: new Date(Date.now() - 10_800_000).toISOString(), amount: "900000000", txHash: "0xv67", asset: "USDC" },
  { id: "e13", type: "alert", streamId: "3", timestamp: new Date(Date.now() - 12_600_000).toISOString(), txHash: "0xw78", asset: "XLM", message: "Stream #3 expires in 24 hours" },
  { id: "e14", type: "cancellation", streamId: "1", timestamp: new Date(Date.now() - 14_400_000).toISOString(), txHash: "0xx89", asset: "USDC" },
  { id: "e15", type: "top-up", streamId: "5", timestamp: new Date(Date.now() - 16_200_000).toISOString(), amount: "2200000000", txHash: "0xy90", asset: "XLM" },
  { id: "e16", type: "withdrawal", streamId: "3", timestamp: new Date(Date.now() - 18_000_000).toISOString(), amount: "1400000000", txHash: "0xz01", asset: "XLM" },
  { id: "e17", type: "creation", streamId: "1", timestamp: new Date(Date.now() - 19_800_000).toISOString(), txHash: "0xa12b", asset: "USDC" },
  { id: "e18", type: "alert", streamId: "2", timestamp: new Date(Date.now() - 21_600_000).toISOString(), txHash: "0xb23c", asset: "USDC", message: "Withdrawal available on Stream #2" },
  { id: "e19", type: "withdrawal", streamId: "5", timestamp: new Date(Date.now() - 23_400_000).toISOString(), amount: "700000000", txHash: "0xc34d", asset: "XLM" },
  { id: "e20", type: "cancellation", streamId: "4", timestamp: new Date(Date.now() - 25_200_000).toISOString(), txHash: "0xd45e", asset: "USDC" },
];

let nextEventId = 21;

export function getStreamEvents(): StreamEvent[] {
  return [...MOCK_EVENTS];
}

export interface ActivityQuery {
  /** Exclusive cursor — an event id. Results start after this event. */
  cursor?: string | null;
  /** Page size. Defaults to 10. */
  limit?: number;
  /** When set, only events whose type is in this list are returned. */
  types?: StreamEvent["type"][];
  /** When set, only events for this asset/token are returned. */
  asset?: string;
  /** ISO date (inclusive lower bound). */
  from?: string;
  /** ISO date (inclusive upper bound, end-of-day). */
  to?: string;
}

export interface ActivityPage {
  events: StreamEvent[];
  nextCursor: string | null;
}

/** Apply the activity query filters to the full event store (no pagination). */
function filterActivityEvents(query: ActivityQuery): StreamEvent[] {
  const { types, asset, from, to } = query;
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() + 86_400_000 - 1 : null;

  return MOCK_EVENTS.filter((ev) => {
    if (types && types.length > 0 && !types.includes(ev.type)) return false;
    if (asset && ev.asset !== asset) return false;
    const ts = new Date(ev.timestamp).getTime();
    if (fromMs !== null && ts < fromMs) return false;
    if (toMs !== null && ts > toMs) return false;
    return true;
  });
}

/**
 * Cursor-paginated, filterable activity feed over all stream events
 * (newest first). Filters are applied before pagination so `nextCursor`
 * always points at the next matching event, not just the next raw event.
 */
export function getActivityEvents(query: ActivityQuery = {}): ActivityPage {
  const { cursor = null, limit = 10 } = query;

  const filtered = filterActivityEvents(query);

  const startIndex = cursor ? filtered.findIndex((ev) => ev.id === cursor) + 1 : 0;
  const page = filtered.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < filtered.length ? page[page.length - 1]?.id ?? null : null;

  return { events: page, nextCursor };
}

/**
 * Return every stream event matching the given query (filters applied, but
 * no cursor/limit pagination). Used to build the full compliance audit log.
 */
export function getActivityEventsAll(query: ActivityQuery = {}): StreamEvent[] {
  return filterActivityEvents(query);
}

export interface AuditLogEntry {
  id: string;
  streamId: string;
  type: StreamEvent["type"];
  timestamp: string;
  transactionHash: string;
  amount?: string;
  asset?: string;
  message?: string;
}

export interface StreamAuditLog {
  /** Schema version for downstream compliance/accounting tooling. */
  version: 1;
  /** When this export was generated (ISO 8601). */
  exportedAt: string;
  /** Total number of events included in the export. */
  count: number;
  /** The filters that were applied to scope this export. */
  filters: {
    types?: StreamEvent["type"][];
    asset?: string;
    from?: string;
    to?: string;
  };
  /** Every stream event in chronological (oldest-first) order. */
  events: AuditLogEntry[];
}

/**
 * Build a compliance-grade audit log of all matching stream events, including
 * timestamps and transaction hashes, ready for JSON export and accounting use.
 * Events are returned oldest-first so the export reads as a chronological ledger.
 */
export function buildStreamAuditLog(query: ActivityQuery = {}): StreamAuditLog {
  const events = getActivityEventsAll(query)
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map<AuditLogEntry>((ev) => ({
      id: ev.id,
      streamId: ev.streamId,
      type: ev.type,
      timestamp: ev.timestamp,
      transactionHash: ev.txHash,
      amount: ev.amount,
      asset: ev.asset,
      message: ev.message,
    }));

  const { types, asset, from, to } = query;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: events.length,
    filters: {
      ...(types && types.length > 0 ? { types } : {}),
      ...(asset ? { asset } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    events,
  };
}

/** Unique asset codes seen across all events, for the asset filter dropdown. */
export function getActivityAssets(): string[] {
  return Array.from(new Set(MOCK_EVENTS.map((e) => e.asset).filter((a): a is string => !!a))).sort();
}

export function addStreamEvent(event: Omit<StreamEvent, "id">): StreamEvent {
  const newEvent: StreamEvent = { ...event, id: `e${nextEventId++}` };
  MOCK_EVENTS.unshift(newEvent);
  return newEvent;
}

export function truncateAddress(address: string): string {
  if (!address) return "";
  // Normalise to uppercase so mixed-case inputs (e.g. from copy-paste or
  // external sources) render the same truncated form as the on-chain address.
  const normalised = address.toUpperCase();
  return `${normalised.slice(0, 4)}...${normalised.slice(-4)}`;
}

// ── Gas fee estimate ─────────────────────────────────────────────────────────

export interface GasFeeEstimate {
  /** Estimated fee in stroops */
  feeStroops: number;
  /** Estimated fee as a formatted string, e.g. "0.0000100" */
  feeFormatted: string;
}

/**
 * Simulates fetching the gas fee estimate for a create_stream transaction.
 * In production this would simulate the transaction envelope and read the
 * fee from the simulation response.
 *
 * @param amountStroops  Stream deposit amount in stroops (affects resource usage)
 */
export async function getGasFeeEstimate(amountStroops: number): Promise<GasFeeEstimate> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 150));
  // Base fee of 100 stroops + a tiny resource charge proportional to deposit size
  const feeStroops = 100 + Math.floor(amountStroops * 0.000001);
  return { feeStroops, feeFormatted: formatStellarAmount(feeStroops) };
}

// ── Collateral config ────────────────────────────────────────────────────────

export interface CollateralConfig {
  /**
   * Collateral rate as a basis-point integer, e.g. 1000 = 10%.
   * A value of 0 means collateral is not required.
   */
  basisPoints: number;
}

/**
 * Simulates reading the current collateral configuration from the contract.
 * New senders must lock collateral equal to (streamAmount * basisPoints / 10_000).
 * Set basisPoints to 0 to test the zero-collateral path.
 */
export async function getCollateralConfig(): Promise<CollateralConfig> {
  // Mock: 10% (1000 bps). Set to 0 to test zero-collateral path.
  return { basisPoints: 1000 };
}

/**
 * Returns true when the given sender address has never created a stream before
 * and therefore is subject to the collateral requirement.
 *
 * @param senderAddress  The connected wallet's Stellar public key
 */
export async function checkIsNewSender(senderAddress: string): Promise<boolean> {
  if (!senderAddress) return false;
  // Mock: treat address as new if they have no streams in the mock store.
  const hasPriorStreams = MOCK_STREAMS.some((s) =>
    s.sender === senderAddress || s.sender.startsWith(senderAddress.slice(0, 5)),
  );
  return !hasPriorStreams;
}

/**
 * Compute the collateral amount in stroops required for a given stream deposit.
 *
 * @param depositStroops  Stream deposit in stroops
 * @param basisPoints     Protocol collateral rate in basis points
 */
export function calcCollateral(
  depositStroops: number,
  basisPoints: number,
): number {
  return Math.ceil((depositStroops * basisPoints) / 10_000);
}

// ── Protocol fee config ──────────────────────────────────────────────────────

export interface FeeConfig {
  /** Fee rate as a basis-point integer, e.g. 50 = 0.50% */
  basisPoints: number;
}

/** Simulates reading the current fee rate from the contract config. */
export async function getFeeConfig(): Promise<FeeConfig> {
  // Mock: 0.50% (50 bps). Set to 0 to test zero-fee path.
  return { basisPoints: 50 };
}

// ── Stream deposit cap ────────────────────────────────────────────────────────

export interface StreamCapConfig {
  /**
   * Maximum allowed deposit per stream in stroops (1 USDC = 10_000_000 stroops).
   * A value of 0 means no cap is enforced.
   */
  maxDepositStroops: number;
}

/**
 * Simulates reading the maximum per-stream deposit cap from the contract.
 * In production this would call the contract's `get_stream_cap` query instruction.
 *
 * The cap is intentionally set to 100_000 USDC (1_000_000_000_000 stroops) so
 * integration tests can exercise the validation path without hitting real limits.
 * Override by setting `NEXT_PUBLIC_MAX_DEPOSIT_STROOPS` in .env.local.
 */
export async function getStreamCapConfig(): Promise<StreamCapConfig> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
  // Mock: 100 000 USDC cap (100_000 * 10_000_000 stroops).
  return { maxDepositStroops: 100_000 * 10_000_000 };
}

// ── Contract version ──────────────────────────────────────────────────────────

/** Version reported by the deployed contract's `version` query instruction. */
const MOCK_DEPLOYED_CONTRACT_VERSION = "1.2.0";

/** Simulates calling the deployed SoroStream contract's `version` query. */
export async function getDeployedContractVersion(): Promise<string> {
  return MOCK_DEPLOYED_CONTRACT_VERSION;
}

/**
 * Break down a withdrawal into claimable amount, protocol fee, and net amount.
 *
 * @param claimableStroops  Raw stroop value the user would receive pre-fee
 * @param basisPoints       Protocol fee rate in basis points (e.g. 50 = 0.5%)
 */
export function calcWithdrawBreakdown(
  claimableStroops: number,
  basisPoints: number,
): {
  claimable: number;
  fee: number;
  net: number;
  feePercent: number;
} {
  const feePercent = basisPoints / 100; // e.g. 50 bps → 0.5%
  const fee = Math.floor((claimableStroops * basisPoints) / 10_000);
  const net = claimableStroops - fee;
  return { claimable: claimableStroops, fee, net, feePercent };
}

// ── Treasury ────────────────────────────────────────────────────────────────

export interface TreasuryBalance {
  /** Token symbol, e.g. "USDC" or "XLM" */
  token: string;
  /** Raw stroop balance accumulated in the treasury */
  balanceStroops: number;
  /** ISO timestamp of the last sweep (null if never swept) */
  lastSweepAt: string | null;
  /** Amount swept in the last sweep (stroops), null if never swept */
  lastSweepAmountStroops: number | null;
}

/** Mock treasury balances — keyed by token. */
const MOCK_TREASURY: TreasuryBalance[] = [
  {
    token: "USDC",
    balanceStroops: 3_750_000_000, // 375 USDC
    lastSweepAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    lastSweepAmountStroops: 1_200_000_000,
  },
  {
    token: "XLM",
    balanceStroops: 8_200_000_000, // 820 XLM
    lastSweepAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    lastSweepAmountStroops: 2_500_000_000,
  },
  {
    token: "wBTC",
    balanceStroops: 0, // No fees collected yet
    lastSweepAt: null,
    lastSweepAmountStroops: null,
  },
];

/** Fetch the treasury balances (simulates a contract query). */
export async function getTreasuryBalances(): Promise<TreasuryBalance[]> {
  return [...MOCK_TREASURY];
}

/** Simulate a sweep_fees contract call. Clears the balance and records sweep metadata. */
export async function sweepTreasuryFees(token: string): Promise<{ txHash: string }> {
  const entry = MOCK_TREASURY.find((t) => t.token === token);
  if (entry) {
    entry.lastSweepAmountStroops = entry.balanceStroops;
    entry.lastSweepAt = new Date().toISOString();
    entry.balanceStroops = 0;
  }
  return { txHash: `mock-sweep-tx-${Date.now()}` };
}

// ── Admin: contract state (pause, whitelist, fee rate) ──────────────────────

export interface ContractState {
  paused: boolean;
  feeBasisPoints: number;
  whitelistedTokens: string[];
}

const MOCK_CONTRACT_STATE: ContractState = {
  paused: false,
  feeBasisPoints: 50,
  whitelistedTokens: ["USDC", "XLM", "AQUA"],
};

/** Fetch current contract-level admin state (simulates a contract query). */
export async function getContractState(): Promise<ContractState> {
  return {
    ...MOCK_CONTRACT_STATE,
    whitelistedTokens: [...MOCK_CONTRACT_STATE.whitelistedTokens],
  };
}

/** Simulate a set_paused admin contract call. */
export async function setContractPaused(paused: boolean): Promise<{ txHash: string }> {
  MOCK_CONTRACT_STATE.paused = paused;
  return { txHash: `mock-pause-tx-${Date.now()}` };
}

/** Simulate a set_fee_rate admin contract call. `basisPoints` must be 0-1000 (0-10%). */
export async function setFeeRate(basisPoints: number): Promise<{ txHash: string }> {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 1000) {
    throw new Error("Fee rate must be an integer between 0 and 1000 basis points.");
  }
  MOCK_CONTRACT_STATE.feeBasisPoints = basisPoints;
  return { txHash: `mock-fee-tx-${Date.now()}` };
}

/** Simulate adding a token to the admin whitelist. */
export async function addWhitelistToken(token: string): Promise<{ txHash: string }> {
  const symbol = token.trim().toUpperCase();
  if (!symbol) throw new Error("Token symbol is required.");
  if (!MOCK_CONTRACT_STATE.whitelistedTokens.includes(symbol)) {
    MOCK_CONTRACT_STATE.whitelistedTokens.push(symbol);
  }
  return { txHash: `mock-whitelist-add-tx-${Date.now()}` };
}

/** Simulate removing a token from the admin whitelist. */
export async function removeWhitelistToken(token: string): Promise<{ txHash: string }> {
  MOCK_CONTRACT_STATE.whitelistedTokens = MOCK_CONTRACT_STATE.whitelistedTokens.filter(
    (t) => t !== token,
  );
  return { txHash: `mock-whitelist-remove-tx-${Date.now()}` };
}

// ── Issue #659: Credential Proof Requirements ────────────────────────────────

export interface Challenge {
  id: string;
  challenge: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface CredentialProofRequest {
  challenge: string;
  signature: string;
  publicKey: string;
  signatureType: "Ed25519" | "secp256k1";
}

export interface CredentialProofResponse {
  isValid: boolean;
  credentialId?: string;
  txHash?: string;
  error?: string;
}

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MOCK_CHALLENGES = new Map<string, Challenge>();
const MOCK_ISSUED_CREDENTIALS = new Map<string, { issuedAt: number; recipientPublicKey: string }>();

/**
 * Generate a new challenge for credential issuance.
 * Returns a challenge object with unique ID and 5-minute expiry.
 */
export function generateChallenge(): Challenge {
  const id = `challenge-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const challenge = Buffer.from(id).toString("hex");
  const createdAt = Date.now();
  const expiresAt = createdAt + CHALLENGE_EXPIRY_MS;

  const challengeObj: Challenge = {
    id,
    challenge,
    createdAt,
    expiresAt,
    used: false,
  };

  MOCK_CHALLENGES.set(id, challengeObj);
  return challengeObj;
}

/**
 * Verify if a challenge is still valid (not expired and not used).
 */
export function isChallengeValid(challengeId: string): boolean {
  const challenge = MOCK_CHALLENGES.get(challengeId);
  if (!challenge) return false;
  if (challenge.used) return false;
  if (Date.now() > challenge.expiresAt) return false;
  return true;
}

/**
 * Verify Ed25519 signature.
 * In production, this would use a proper cryptographic library.
 */
function verifyEd25519Signature(challenge: string, signature: string, publicKey: string): boolean {
  // Mock implementation: in production, use tweetnacl.js or similar
  // For now, verify signature length and format
  if (!signature || signature.length < 64) return false;
  if (!publicKey || publicKey.length < 32) return false;
  // Simple validation: signature and public key must be non-empty hex strings
  try {
    Buffer.from(signature, "hex");
    Buffer.from(publicKey, "hex");
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify secp256k1 signature.
 * In production, this would use a proper cryptographic library.
 */
function verifySecp256k1Signature(challenge: string, signature: string, publicKey: string): boolean {
  // Mock implementation: in production, use elliptic or similar
  if (!signature || signature.length < 64) return false;
  if (!publicKey || publicKey.length < 64) return false;
  // Simple validation: signature and public key must be non-empty hex strings
  try {
    Buffer.from(signature, "hex");
    Buffer.from(publicKey, "hex");
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify signed challenge and issue credential if valid.
 * Supports Ed25519 and secp256k1 signatures.
 */
export async function issueCredentialWithProof(
  challengeId: string,
  proofRequest: CredentialProofRequest,
): Promise<CredentialProofResponse> {
  // Check if challenge exists and is valid
  if (!isChallengeValid(challengeId)) {
    return {
      isValid: false,
      error: "Challenge invalid, expired, or already used",
    };
  }

  // Verify the signature based on type
  let signatureValid = false;
  if (proofRequest.signatureType === "Ed25519") {
    signatureValid = verifyEd25519Signature(
      proofRequest.challenge,
      proofRequest.signature,
      proofRequest.publicKey,
    );
  } else if (proofRequest.signatureType === "secp256k1") {
    signatureValid = verifySecp256k1Signature(
      proofRequest.challenge,
      proofRequest.signature,
      proofRequest.publicKey,
    );
  } else {
    return {
      isValid: false,
      error: "Unsupported signature type",
    };
  }

  if (!signatureValid) {
    return {
      isValid: false,
      error: "Invalid signature",
    };
  }

  // Mark challenge as used
  const challenge = MOCK_CHALLENGES.get(challengeId);
  if (challenge) {
    challenge.used = true;
  }

  // Issue credential
  const credentialId = `credential-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  MOCK_ISSUED_CREDENTIALS.set(credentialId, {
    issuedAt: Date.now(),
    recipientPublicKey: proofRequest.publicKey,
  });

  return {
    isValid: true,
    credentialId,
    txHash: `mock-credential-tx-${Date.now()}`,
  };
}

/**
 * Get credential proof status (for verification purposes).
 */
export function getCredentialStatus(credentialId: string): { isValid: boolean; issuedAt?: number } {
  const credential = MOCK_ISSUED_CREDENTIALS.get(credentialId);
  if (!credential) {
    return { isValid: false };
  }
  return { isValid: true, issuedAt: credential.issuedAt };
}

/**
 * Clean up expired challenges (should be called periodically).
 */
export function cleanupExpiredChallenges(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, challenge] of MOCK_CHALLENGES.entries()) {
    if (now > challenge.expiresAt) {
      MOCK_CHALLENGES.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

// ── Issue #658: Multi-Signature Admin Operations ───────────────────────────

export interface AdminAction {
  id: string;
  action: "pause" | "unpause" | "set_fee" | "add_issuer" | "remove_issuer" | "add_reporter" | "remove_reporter";
  params: Record<string, unknown>;
  status: "pending" | "approved" | "executed" | "rejected" | "expired";
  proposedBy: string;
  proposedAt: number;
  expiresAt: number;
  approvals: Set<string>;
  requiredThreshold: number;
}

export interface ProposalEvent {
  id: string;
  actionId: string;
  eventType: "proposed" | "approved" | "executed" | "rejected" | "expired";
  timestamp: number;
  actor: string;
  details?: string;
}

const ADMIN_THRESHOLD = 2; // Default: 2-of-3 multisig
const PROPOSAL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MOCK_ADMIN_SIGNERS = new Set<string>([
  "GDZST3XVCDTUJ76ZAV2HA72KYXM4DCKWRFDADMHRCWWXHJVZOM7Z2VJR", // Admin 1
  "GB7VSUXWJZQRFNVQRH4SVPZPEVKD5LTQE5JMQVTXCUVJMHPPZCFDVKDA", // Admin 2
  "GBAXMYFXDQX527U3A3C35TQFKXJ7BVRWVYKSVVQN2T2NRVQFNWTZVFPJ", // Admin 3
]);

const MOCK_ADMIN_PROPOSALS = new Map<string, AdminAction>();
const MOCK_PROPOSAL_EVENTS: ProposalEvent[] = [];
let NEXT_PROPOSAL_ID = 1;
let NEXT_EVENT_ID = 1;

/**
 * Get the current set of admin signers.
 */
export function getAdminSigners(): string[] {
  return Array.from(MOCK_ADMIN_SIGNERS);
}

/**
 * Add a new admin signer (must be approved via multisig in production).
 */
export function addAdminSigner(address: string): { success: boolean; message: string } {
  if (MOCK_ADMIN_SIGNERS.has(address)) {
    return { success: false, message: "Signer already exists" };
  }
  MOCK_ADMIN_SIGNERS.add(address);
  return { success: true, message: "Admin signer added" };
}

/**
 * Remove an admin signer (must be approved via multisig in production).
 */
export function removeAdminSigner(address: string): { success: boolean; message: string } {
  if (!MOCK_ADMIN_SIGNERS.has(address)) {
    return { success: false, message: "Signer not found" };
  }
  if (MOCK_ADMIN_SIGNERS.size <= ADMIN_THRESHOLD) {
    return { success: false, message: "Cannot remove signer: minimum threshold would be violated" };
  }
  MOCK_ADMIN_SIGNERS.delete(address);
  return { success: true, message: "Admin signer removed" };
}

/**
 * Propose a new admin action (e.g., pause contract, set fee rate, add issuer).
 * Returns the proposal ID.
 */
export function proposeAdminAction(
  action: AdminAction["action"],
  params: Record<string, unknown>,
  proposedBy: string,
): { proposalId: string; expiresAt: number } {
  const proposalId = `proposal-${NEXT_PROPOSAL_ID++}-${Date.now()}`;
  const now = Date.now();
  const expiresAt = now + PROPOSAL_TIMEOUT_MS;

  const adminAction: AdminAction = {
    id: proposalId,
    action,
    params,
    status: "pending",
    proposedBy,
    proposedAt: now,
    expiresAt,
    approvals: new Set(),
    requiredThreshold: ADMIN_THRESHOLD,
  };

  MOCK_ADMIN_PROPOSALS.set(proposalId, adminAction);

  // Emit proposal event
  const event: ProposalEvent = {
    id: `event-${NEXT_EVENT_ID++}`,
    actionId: proposalId,
    eventType: "proposed",
    timestamp: now,
    actor: proposedBy,
    details: `Action proposed: ${action}`,
  };
  MOCK_PROPOSAL_EVENTS.push(event);

  return { proposalId, expiresAt };
}

/**
 * Approve an admin action proposal.
 * Returns whether the action has reached the approval threshold.
 */
export function approveAdminAction(
  proposalId: string,
  approverAddress: string,
): { success: boolean; message: string; thresholdReached?: boolean } {
  const proposal = MOCK_ADMIN_PROPOSALS.get(proposalId);

  if (!proposal) {
    return { success: false, message: "Proposal not found", thresholdReached: false };
  }

  if (!MOCK_ADMIN_SIGNERS.has(approverAddress)) {
    return { success: false, message: "Approver is not an authorized admin signer", thresholdReached: false };
  }

  if (proposal.status !== "pending") {
    return { success: false, message: `Proposal status is ${proposal.status}, cannot approve`, thresholdReached: false };
  }

  if (Date.now() > proposal.expiresAt) {
    proposal.status = "expired";
    return { success: false, message: "Proposal has expired", thresholdReached: false };
  }

  if (proposal.approvals.has(approverAddress)) {
    return { success: false, message: "This admin has already approved this proposal", thresholdReached: false };
  }

  proposal.approvals.add(approverAddress);

  const thresholdReached = proposal.approvals.size >= proposal.requiredThreshold;

  // Emit approval event
  const event: ProposalEvent = {
    id: `event-${NEXT_EVENT_ID++}`,
    actionId: proposalId,
    eventType: "approved",
    timestamp: Date.now(),
    actor: approverAddress,
    details: `Approval ${proposal.approvals.size}/${proposal.requiredThreshold}`,
  };
  MOCK_PROPOSAL_EVENTS.push(event);

  if (thresholdReached) {
    proposal.status = "approved";
  }

  return {
    success: true,
    message: `Approval recorded (${proposal.approvals.size}/${proposal.requiredThreshold})`,
    thresholdReached,
  };
}

/**
 * Execute an approved admin action.
 * Can only be called once the approval threshold is reached.
 */
export async function executeAdminAction(
  proposalId: string,
  executorAddress: string,
): Promise<{ success: boolean; message: string; txHash?: string }> {
  const proposal = MOCK_ADMIN_PROPOSALS.get(proposalId);

  if (!proposal) {
    return { success: false, message: "Proposal not found" };
  }

  if (!MOCK_ADMIN_SIGNERS.has(executorAddress)) {
    return { success: false, message: "Executor is not an authorized admin signer" };
  }

  if (proposal.status !== "approved") {
    return { success: false, message: `Proposal must be approved before execution (current: ${proposal.status})` };
  }

  // Execute the action
  try {
    switch (proposal.action) {
      case "pause":
        MOCK_CONTRACT_STATE.paused = true;
        break;
      case "unpause":
        MOCK_CONTRACT_STATE.paused = false;
        break;
      case "set_fee":
        if (typeof proposal.params.basisPoints === "number") {
          MOCK_CONTRACT_STATE.feeBasisPoints = proposal.params.basisPoints;
        }
        break;
      case "add_issuer":
      case "add_reporter":
        // These would update issuer/reporter lists in production
        break;
      case "remove_issuer":
      case "remove_reporter":
        // These would update issuer/reporter lists in production
        break;
    }

    proposal.status = "executed";
    const txHash = `mock-multisig-tx-${Date.now()}`;

    // Emit execution event
    const event: ProposalEvent = {
      id: `event-${NEXT_EVENT_ID++}`,
      actionId: proposalId,
      eventType: "executed",
      timestamp: Date.now(),
      actor: executorAddress,
      details: `Action executed: ${proposal.action}`,
    };
    MOCK_PROPOSAL_EVENTS.push(event);

    return {
      success: true,
      message: `Action executed successfully`,
      txHash,
    };
  } catch (error) {
    proposal.status = "rejected";
    return {
      success: false,
      message: `Execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get proposal details.
 */
export function getAdminProposal(proposalId: string): AdminAction | null {
  const proposal = MOCK_ADMIN_PROPOSALS.get(proposalId);
  if (!proposal) return null;

  // Return a copy to prevent external modifications
  return {
    ...proposal,
    approvals: new Set(proposal.approvals),
  };
}

/**
 * Get all admin proposals (pending, approved, executed, etc.).
 */
export function getAdminProposals(
  status?: AdminAction["status"],
): AdminAction[] {
  const proposals = Array.from(MOCK_ADMIN_PROPOSALS.values());

  if (status) {
    return proposals.filter((p) => p.status === status);
  }

  return proposals;
}

/**
 * Get proposal lifecycle events.
 */
export function getProposalEvents(proposalId?: string): ProposalEvent[] {
  if (proposalId) {
    return MOCK_PROPOSAL_EVENTS.filter((e) => e.actionId === proposalId);
  }
  return [...MOCK_PROPOSAL_EVENTS];
}

/**
 * Clean up expired proposals.
 */
export function cleanupExpiredProposals(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, proposal] of MOCK_ADMIN_PROPOSALS.entries()) {
    if (proposal.status === "pending" && now > proposal.expiresAt) {
      proposal.status = "expired";

      // Emit expiration event
      const event: ProposalEvent = {
        id: `event-${NEXT_EVENT_ID++}`,
        actionId: id,
        eventType: "expired",
        timestamp: now,
        actor: "system",
        details: "Proposal expired due to timeout",
      };
      MOCK_PROPOSAL_EVENTS.push(event);

      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Tests for getStreamedAmount — covers:
 *   #483: function must be exported (absence was causing ReferenceError on stream
 *         detail page, resulting in a blank screen for non-existent stream IDs)
 *   #482: future streams must return 0 (progress clamped to stream start time)
 */
import { describe, it, expect } from "vitest";
import { getStreamedAmount, getMockStream } from "@/src/lib/sorostream";

function makeStream(
  overrides: Record<string, unknown> = {},
  baseNow: number = Date.now(),
) {
  return {
    id: "test",
    sender: "GAA",
    recipient: "GBB",
    token: "USDC",
    flowRate: 1_000_000, // 0.1 USDC / sec
    deposit: 100_000_000, // 10 USDC
    startTime: new Date(baseNow - 100_000).toISOString(),
    endTime: new Date(baseNow + 100_000).toISOString(),
    lastWithdrawTime: new Date(baseNow - 100_000).toISOString(),
    status: "Active" as const,
    ...overrides,
  };
}

describe("getStreamedAmount (#483 — function must be exported)", () => {
  it("is a function (presence guards against the missing-export ReferenceError)", () => {
    expect(typeof getStreamedAmount).toBe("function");
  });

  it("returns 0 for null/undefined input", () => {
    expect(getStreamedAmount(null)).toBe(0);
    expect(getStreamedAmount(undefined)).toBe(0);
  });
});

describe("getStreamedAmount — active streams", () => {
  it("returns a positive number for a stream that started in the past", () => {
    const stream = makeStream(); // started 100s ago
    const streamed = getStreamedAmount(stream);
    // At least 100s of flow should have streamed (100s × 1_000_000 rate)
    expect(streamed).toBeGreaterThanOrEqual(100_000_000);
  });

  it("returns an integer (floored) value", () => {
    const stream = makeStream();
    const streamed = getStreamedAmount(stream);
    expect(Number.isInteger(streamed)).toBe(true);
  });
});

// ── Issue #482: future-stream clamping ────────────────────────────────────────
describe("getStreamedAmount — future streams (#482)", () => {
  it("returns 0 for a stream that starts in the future", () => {
    const baseNow = Date.now();
    const stream = makeStream(
      {
        startTime: new Date(baseNow + 86_400_000).toISOString(), // starts tomorrow
        endTime: new Date(baseNow + 86_400_000 * 11).toISOString(),
        lastWithdrawTime: new Date(baseNow + 86_400_000).toISOString(),
        status: "Active",
      },
      baseNow,
    );
    expect(getStreamedAmount(stream)).toBe(0);
  });

  it("returns 0 for a stream starting exactly now (edge case)", () => {
    const now = Date.now();
    const stream = makeStream({
      startTime: new Date(now).toISOString(),
      endTime: new Date(now + 10_000).toISOString(),
      lastWithdrawTime: new Date(now).toISOString(),
      flowRate: 1_000_000,
    });
    // May be 0 or a very small number depending on timing — must be non-negative
    expect(getStreamedAmount(stream)).toBeGreaterThanOrEqual(0);
  });
});

describe("getStreamedAmount — paused streams", () => {
  it("freezes streamed amount at the moment of pausing", () => {
    const baseNow = Date.now();
    const pausedAt = new Date(baseNow - 50_000).toISOString(); // paused 50s after start
    const stream = makeStream(
      {
        status: "Paused",
        pausedAt,
        startTime: new Date(baseNow - 100_000).toISOString(),
      },
      baseNow,
    );
    // paused 50s in: 50 * 1_000_000 = 50_000_000
    expect(getStreamedAmount(stream)).toBe(50_000_000);
  });
});

describe("getStreamedAmount — ended/cancelled streams", () => {
  it("caps at endTime for ended streams", () => {
    const baseNow = Date.now();
    const stream = makeStream({
      status: "Ended",
      startTime: new Date(baseNow - 200_000).toISOString(),
      endTime: new Date(baseNow - 100_000).toISOString(), // ended 100s ago
      flowRate: 1_000_000,
    });
    // Only 100s could have streamed (start → end), not 200s
    expect(getStreamedAmount(stream)).toBe(100_000_000);
  });

  it("caps at cancelledAt for cancelled streams with cancelledAt set", () => {
    const baseNow = Date.now();
    // Make timestamps align to whole seconds to avoid floor-rounding discrepancy
    const startEpochMs = Math.floor(baseNow / 1000) * 1000 - 200_000;
    const cancelledAtSec = Math.floor(baseNow / 1000) - 60; // cancelled 60s ago

    const stream = {
      id: "test",
      sender: "GAA",
      recipient: "GBB",
      token: "USDC",
      flowRate: 1_000_000,
      deposit: 100_000_000,
      startTime: new Date(startEpochMs).toISOString(),
      endTime: new Date(startEpochMs + 300_000).toISOString(),
      lastWithdrawTime: new Date(startEpochMs).toISOString(),
      status: "Cancelled" as const,
      cancelledAt: cancelledAtSec,
    };

    // Elapsed from startEpochMs to cancelledAt: (200s - 60s) = 140s
    const expectedElapsedSeconds = cancelledAtSec - startEpochMs / 1000;
    const expectedStreamed = Math.floor(1_000_000 * expectedElapsedSeconds);
    expect(getStreamedAmount(stream)).toBe(expectedStreamed);
  });
});

// ── getMockStream returns null for unknown IDs (#483 contract) ────────────────
describe("getMockStream — not-found behaviour (#483)", () => {
  it("returns null for a stream ID that does not exist", () => {
    expect(getMockStream("nonexistent-id-xyz")).toBeNull();
  });

  it("returns null for an empty string ID", () => {
    expect(getMockStream("")).toBeNull();
  });

  it("returns a StreamData object for a known ID", () => {
    const stream = getMockStream("1");
    expect(stream).not.toBeNull();
    expect(stream?.id).toBe("1");
  });
});

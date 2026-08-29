import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import StreamProgressBar from "../StreamProgressBar";
import type { StreamData } from "@/src/lib/sorostream";

const now = Date.now();

const SAMPLE_STREAM: StreamData = {
  id: "1",
  sender: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  recipient: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
  deposit: 1000000000,
  flowRate: 100,
  startTime: new Date(now - 60000).toISOString(), // 60s ago
  endTime: new Date(now + 40000).toISOString(),   // 40s in future -> 60% elapsed
  lastWithdrawTime: new Date(now - 60000).toISOString(),
  status: "Active",
  token: "USDC",
};

/** Stream that starts 2 days in the future (issue #482 regression guard). */
const FUTURE_STREAM: StreamData = {
  id: "9",
  sender: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  recipient: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
  deposit: 6000000000,
  flowRate: 600000,
  startTime: new Date(now + 86400000 * 2).toISOString(), // starts in 2 days
  endTime: new Date(now + 86400000 * 12).toISOString(),  // ends in 12 days
  lastWithdrawTime: new Date(now + 86400000 * 2).toISOString(),
  status: "Active",
  token: "USDC",
};

describe("StreamProgressBar Milestones", () => {
  it("renders 25%, 50%, and 75% milestone markers on the progress bar track", () => {
    render(<StreamProgressBar stream={SAMPLE_STREAM} />);

    const m25 = screen.getByTestId("milestone-marker-25");
    const m50 = screen.getByTestId("milestone-marker-50");
    const m75 = screen.getByTestId("milestone-marker-75");

    expect(m25).toBeInTheDocument();
    expect(m50).toBeInTheDocument();
    expect(m75).toBeInTheDocument();

    expect(m25).toHaveTextContent("25%");
    expect(m50).toHaveTextContent("50%");
    expect(m75).toHaveTextContent("75%");
  });

  it("marks reached milestones (25% and 50%) as reached when percentage is ~60%", () => {
    render(<StreamProgressBar stream={SAMPLE_STREAM} />);

    const m25 = screen.getByTestId("milestone-marker-25");
    const m50 = screen.getByTestId("milestone-marker-50");
    const m75 = screen.getByTestId("milestone-marker-75");

    expect(m25.getAttribute("data-reached")).toBe("true");
    expect(m50.getAttribute("data-reached")).toBe("true");
    expect(m75.getAttribute("data-reached")).toBe("false");
  });
});

// ── Issue #482: future streams must show 0% progress ─────────────────────────
describe("StreamProgressBar future-stream clamping (#482)", () => {
  it("shows 0% progress for a stream that has not started yet", () => {
    render(<StreamProgressBar stream={FUTURE_STREAM} />);

    // The progress bar aria-valuenow should be 0
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
  });

  it("does not mark any milestone as reached for a future stream", () => {
    render(<StreamProgressBar stream={FUTURE_STREAM} />);

    const m25 = screen.getByTestId("milestone-marker-25");
    const m50 = screen.getByTestId("milestone-marker-50");
    const m75 = screen.getByTestId("milestone-marker-75");

    expect(m25.getAttribute("data-reached")).toBe("false");
    expect(m50.getAttribute("data-reached")).toBe("false");
    expect(m75.getAttribute("data-reached")).toBe("false");
  });
});

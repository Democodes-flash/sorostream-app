import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StreamHealthCard from "@/components/StreamHealthCard";
import type { StreamData } from "@/src/lib/sorostream";

const mockActiveStream: StreamData = {
  id: "1",
  sender: "GBAM...1234",
  recipient: "GDEM...5678",
  flowRate: 10_000_000, // 1 XLM/sec
  deposit: 1_000_000_000,
  startTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  endTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  lastWithdrawTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  status: "Active",
  token: "USDC",
};

const mockEndedStream: StreamData = {
  id: "2",
  sender: "GBAM...1234",
  recipient: "GDEM...5678",
  flowRate: 10_000_000,
  deposit: 1_000_000_000,
  startTime: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  endTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  lastWithdrawTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  status: "Ended",
  token: "USDC",
};

const mockCancelledStream: StreamData = {
  id: "3",
  sender: "GBAM...1234",
  recipient: "GDEM...5678",
  flowRate: 10_000_000,
  deposit: 1_000_000_000,
  startTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  endTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  lastWithdrawTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  status: "Cancelled",
  token: "USDC",
};

describe("StreamHealthCard", () => {
  it("renders active stream health with real-time countdown and flow rate", () => {
    render(<StreamHealthCard stream={mockActiveStream} />);

    expect(screen.getByTestId("stream-health-card")).toBeInTheDocument();
    expect(screen.getByTestId("health-status-badge")).toBeInTheDocument();
    expect(screen.getByTestId("health-time-remaining")).toBeInTheDocument();
    expect(screen.getByTestId("health-flow-rate")).toBeInTheDocument();
  });

  it("renders completed status and settled amount for ended stream", () => {
    render(<StreamHealthCard stream={mockEndedStream} />);

    expect(screen.getByTestId("health-status-badge")).toHaveTextContent("Completed");
    expect(screen.getByTestId("health-settled-info")).toBeInTheDocument();
  });

  it("renders cancelled status and refund breakdown for cancelled stream", () => {
    render(<StreamHealthCard stream={mockCancelledStream} />);

    expect(screen.getByTestId("health-status-badge")).toHaveTextContent("Cancelled");
    expect(screen.getByTestId("health-cancelled-info")).toBeInTheDocument();
  });
});

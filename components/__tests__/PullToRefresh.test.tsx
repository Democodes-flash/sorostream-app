import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PullToRefresh from "@/components/PullToRefresh";

describe("PullToRefresh", () => {
  it("renders children correctly", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>Stream List Content</div>
      </PullToRefresh>
    );

    expect(screen.getByText("Stream List Content")).toBeInTheDocument();
    expect(screen.getByTestId("pull-to-refresh-container")).toBeInTheDocument();
  });

  it("handles touch events and triggers refresh past threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div>Stream List Content</div>
      </PullToRefresh>
    );

    const container = screen.getByTestId("pull-to-refresh-container");

    fireEvent.touchStart(container, { touches: [{ clientY: 50 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(container);

    expect(onRefresh).toHaveBeenCalled();
  });
});

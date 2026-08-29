import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import EndDatePicker from "../EndDatePicker";

// ---------------------------------------------------------------------------
// Mock timezone utilities so tests are timezone-independent
// ---------------------------------------------------------------------------

vi.mock("@/src/lib/timezone", () => ({
  getUserTimezone: () => "UTC",
  listTimezones: () => ["UTC", "America/New_York", "Europe/London"],
  zonedWallTimeToUtc: (wall: string, _tz: string) => {
    if (!wall) return null;
    const d = new Date(wall);
    return isNaN(d.getTime()) ? null : d;
  },
  formatWallTimeInZone: (_date: Date, _tz: string) => "2099-01-01T12:00",
  formatDateWithTimezone: (d: Date) => d.toISOString(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a datetime-local string shifted by `offsetMs` from now. */
function wallTimeOffset(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  return d.toISOString().slice(0, 16);
}

/** Get the datetime-local input by its id */
function getDateInput() {
  return document.getElementById("end-date") as HTMLInputElement;
}

describe("EndDatePicker — past-date validation (#487)", () => {
  const mockOnChange = vi.fn();
  const mockOnDurationResolved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without error by default", () => {
    render(<EndDatePicker onChange={mockOnChange} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls onChange with ISO UTC string when a future date is selected", () => {
    render(
      <EndDatePicker
        onChange={mockOnChange}
        onDurationResolved={mockOnDurationResolved}
      />
    );
    const futureWall = wallTimeOffset(60 * 60 * 1000); // 1 hour from now
    fireEvent.change(getDateInput(), { target: { value: futureWall } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const calledWith = mockOnChange.mock.calls[0][0];
    expect(calledWith).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string
    expect(calledWith).not.toBe(""); // not cleared
    expect(mockOnDurationResolved).toHaveBeenCalledTimes(1);
    expect(mockOnDurationResolved.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("shows an internal error and calls onChange('') when a past date is selected", () => {
    render(
      <EndDatePicker
        onChange={mockOnChange}
        onDurationResolved={mockOnDurationResolved}
      />
    );
    const pastWall = wallTimeOffset(-60 * 60 * 1000); // 1 hour ago
    fireEvent.change(getDateInput(), { target: { value: pastWall } });

    // Error message must appear
    expect(screen.getByRole("alert")).toHaveTextContent(
      /end date must be in the future/i
    );

    // onChange must be called with empty string (not the past date)
    expect(mockOnChange).toHaveBeenCalledWith("");

    // Duration should be reported as 0
    expect(mockOnDurationResolved).toHaveBeenCalledWith(0);
  });

  it("shows an internal error when a date exactly at now is selected", () => {
    // Simulate selecting exactly Date.now() — which is not strictly in the future
    const nowWall = wallTimeOffset(0);
    render(
      <EndDatePicker onChange={mockOnChange} onDurationResolved={mockOnDurationResolved} />
    );
    fireEvent.change(getDateInput(), { target: { value: nowWall } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /end date must be in the future/i
    );
    expect(mockOnChange).toHaveBeenCalledWith("");
  });

  it("clears the internal error when a valid future date is subsequently selected", () => {
    render(
      <EndDatePicker onChange={mockOnChange} onDurationResolved={mockOnDurationResolved} />
    );
    const input = getDateInput();

    // First pick a past date
    fireEvent.change(input, { target: { value: wallTimeOffset(-3600_000) } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Then pick a future date
    fireEvent.change(input, { target: { value: wallTimeOffset(3600_000) } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error and calls onChange('') when the input is cleared", () => {
    render(<EndDatePicker onChange={mockOnChange} />);
    const input = getDateInput();

    fireEvent.change(input, { target: { value: wallTimeOffset(-3600_000) } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mockOnChange).toHaveBeenLastCalledWith("");
  });

  it("renders the datetime-local input with a min attribute set to now", () => {
    render(<EndDatePicker onChange={mockOnChange} />);
    const input = getDateInput();
    const minAttr = input.getAttribute("min");
    expect(minAttr).toBeTruthy();
    // min should be a datetime-local value (YYYY-MM-DDTHH:MM)
    expect(minAttr).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("displays the externally supplied error prop", () => {
    render(
      <EndDatePicker onChange={mockOnChange} error="Custom external error" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Custom external error");
  });

  it("sets aria-invalid on the input when there is a validation error", () => {
    render(<EndDatePicker onChange={mockOnChange} error="Some error" />);
    const input = getDateInput();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid when there is no error", () => {
    render(<EndDatePicker onChange={mockOnChange} />);
    const input = getDateInput();
    expect(input).toHaveAttribute("aria-invalid", "false");
  });
});

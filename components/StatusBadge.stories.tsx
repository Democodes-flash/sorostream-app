import type { Meta, StoryObj } from "@storybook/react";
import StatusBadge from "@/components/StatusBadge";

/**
 * **StatusBadge** is a colour-coded pill that communicates the lifecycle
 * state of a stream at a glance.
 *
 * | Status    | Colour | Meaning                                 |
 * |-----------|--------|-----------------------------------------|
 * | Active    | Green  | Funds are streaming to the recipient    |
 * | Paused    | Amber  | Stream temporarily frozen               |
 * | Completed | Blue   | All funds distributed successfully      |
 * | Ended     | Blue   | Alias for Completed                     |
 * | Cancelled | Red    | Stream terminated before completion     |
 * | Scheduled | Blue   | Stream is queued, not yet started       |
 * | Unknown   | Gray   | Unrecognised / fallback state           |
 *
 * The `compact` prop reduces padding for use in dense layouts (tables, lists).
 */
const meta: Meta<typeof StatusBadge> = {
  title: "UI/StatusBadge",
  component: StatusBadge,
  argTypes: {
    status: {
      control: "select",
      options: [
        "Active",
        "Paused",
        "Completed",
        "Ended",
        "Cancelled",
        "Scheduled",
        "Unknown",
      ],
      description: "Stream lifecycle status to display.",
    },
    compact: {
      control: "boolean",
      description: "Render a smaller badge suitable for compact layouts.",
    },
  },
  args: {
    compact: false,
  },
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof StatusBadge>;

// ── Individual status variants ────────────────────────────────────────────

/**
 * Green badge — stream is live and funds are actively flowing to the recipient.
 */
export const Active: Story = {
  args: { status: "Active" },
};

/**
 * Amber badge — stream is temporarily frozen. Remaining balance is preserved
 * and flow will resume once the stream is unpaused.
 */
export const Paused: Story = {
  args: { status: "Paused" },
};

/**
 * Blue badge — stream ran to completion and all funds were distributed
 * to the recipient.
 */
export const Completed: Story = {
  args: { status: "Completed" },
};

/**
 * Blue badge — `Ended` is an alias for `Completed` used by some SDK versions.
 * Visually identical to the Completed variant.
 */
export const Ended: Story = {
  args: { status: "Ended" },
};

/**
 * Red badge — stream was terminated by the sender before completion.
 * Any remaining deposit is returned.
 */
export const Cancelled: Story = {
  args: { status: "Cancelled" },
};

/**
 * Blue/pulse badge — stream is queued with a future start time and
 * has not yet begun streaming.
 */
export const Scheduled: Story = {
  args: { status: "Scheduled" },
};

/**
 * Gray fallback badge for any unrecognised status string.
 * Prevents blank renders when the SDK introduces new states.
 */
export const UnknownStatus: Story = {
  name: "Unknown (fallback)",
  args: { status: "Unknown" },
};

// ── Compact variants ──────────────────────────────────────────────────────

/**
 * Compact `Active` badge — smaller padding for dense layouts such as
 * data tables or dashboard list items.
 */
export const ActiveCompact: Story = {
  name: "Active (compact)",
  args: { status: "Active", compact: true },
};

/** Compact `Paused` badge. */
export const PausedCompact: Story = {
  name: "Paused (compact)",
  args: { status: "Paused", compact: true },
};

/** Compact `Completed` badge. */
export const CompletedCompact: Story = {
  name: "Completed (compact)",
  args: { status: "Completed", compact: true },
};

/** Compact `Cancelled` badge. */
export const CancelledCompact: Story = {
  name: "Cancelled (compact)",
  args: { status: "Cancelled", compact: true },
};

/** Compact `Scheduled` badge. */
export const ScheduledCompact: Story = {
  name: "Scheduled (compact)",
  args: { status: "Scheduled", compact: true },
};

// ── All statuses side-by-side ─────────────────────────────────────────────

/**
 * All six statuses rendered together — useful for visual regression snapshots
 * and confirming colour contrast at a glance.
 */
export const AllStatuses: Story = {
  name: "All statuses",
  render: () => (
    <div className="flex flex-wrap gap-3 items-center">
      {(
        [
          "Active",
          "Paused",
          "Completed",
          "Ended",
          "Cancelled",
          "Scheduled",
          "Unknown",
        ] as const
      ).map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

/**
 * All statuses in compact mode, mirroring dense list/table layouts.
 */
export const AllStatusesCompact: Story = {
  name: "All statuses (compact)",
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      {(
        [
          "Active",
          "Paused",
          "Completed",
          "Ended",
          "Cancelled",
          "Scheduled",
          "Unknown",
        ] as const
      ).map((status) => (
        <StatusBadge key={status} status={status} compact />
      ))}
    </div>
  ),
};

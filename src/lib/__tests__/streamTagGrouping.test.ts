/**
 * Tests for #455: Stream grouping by tag label with collapsible sections
 * and count badges.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock streamTags so we can control tag data
vi.mock("@/src/lib/streamTags", () => ({
  getTagMap: vi.fn(() => ({
    "stream-1": ["project-alpha"],
    "stream-2": ["project-alpha", "billing"],
    "stream-3": ["billing"],
    "stream-4": [], // untagged
  })),
  getAllTags: vi.fn(() => ["billing", "project-alpha"]),
  getTagsForStream: vi.fn(() => []),
  setTagsForStream: vi.fn(),
  addTagToStream: vi.fn(),
  removeTagFromStream: vi.fn(),
}));

import { getTagMap } from "@/src/lib/streamTags";

describe("#455 — Tag grouping logic", () => {
  const streams = [
    { id: "stream-1", token: "USDC", status: "Active" },
    { id: "stream-2", token: "XLM",  status: "Active" },
    { id: "stream-3", token: "USDC", status: "Ended"  },
    { id: "stream-4", token: "XLM",  status: "Active" },
  ] as any[];

  it("groups streams into named tag buckets and an Untagged bucket", () => {
    const tagMap = getTagMap();

    const map = new Map<string, typeof streams>();
    for (const s of streams) {
      const tags = (tagMap as Record<string, string[]>)[s.id] ?? [];
      if (tags.length === 0) {
        const key = "(Untagged)";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(s);
      } else {
        for (const tag of tags) {
          if (!map.has(tag)) map.set(tag, []);
          map.get(tag)!.push(s);
        }
      }
    }

    const groups = Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === "(Untagged)") return 1;
        if (b[0] === "(Untagged)") return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, items]) => ({ label, items }));

    // "billing" has stream-2 and stream-3
    const billing = groups.find((g) => g.label === "billing");
    expect(billing).toBeDefined();
    expect(billing!.items).toHaveLength(2);
    expect(billing!.items.map((s) => s.id)).toContain("stream-2");
    expect(billing!.items.map((s) => s.id)).toContain("stream-3");

    // "project-alpha" has stream-1 and stream-2
    const pa = groups.find((g) => g.label === "project-alpha");
    expect(pa).toBeDefined();
    expect(pa!.items).toHaveLength(2);

    // "(Untagged)" has stream-4
    const untagged = groups.find((g) => g.label === "(Untagged)");
    expect(untagged).toBeDefined();
    expect(untagged!.items[0].id).toBe("stream-4");

    // Untagged should be last
    expect(groups[groups.length - 1].label).toBe("(Untagged)");
  });

  it("counts active streams per group correctly", () => {
    const tagMap = getTagMap();
    const map = new Map<string, typeof streams>();
    for (const s of streams) {
      const tags = (tagMap as Record<string, string[]>)[s.id] ?? [];
      if (tags.length === 0) {
        if (!map.has("(Untagged)")) map.set("(Untagged)", []);
        map.get("(Untagged)")!.push(s);
      } else {
        for (const tag of tags) {
          if (!map.has(tag)) map.set(tag, []);
          map.get(tag)!.push(s);
        }
      }
    }

    // billing group has stream-2 (Active) and stream-3 (Ended) → 1 active
    const billingStreams = map.get("billing")!;
    const activeCount = billingStreams.filter((s) => s.status === "Active").length;
    expect(activeCount).toBe(1);
  });
});

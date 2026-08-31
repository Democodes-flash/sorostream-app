"use client";

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { StreamListSkeleton, SkeletonCard } from "@/components/Skeleton";
import StreamVirtualList from "@/components/StreamVirtualList";
import StreamEventFeed from "@/components/StreamEventFeed";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import StatusLegend from "@/components/StatusLegend";
import { StreamErrorBoundary } from "@/components/StreamErrorBoundary";
import { getStreamsForWallet, watchClaimable, sorostream, getMockStreamHistory, type StreamData } from "@/src/lib/sorostream";
import { useRpcFetch } from "@/src/lib/useRpcFetch";
import { useToast } from "@/src/lib/toast";
import { downloadCSV, downloadWalletStreamsCsv } from "@/src/lib/export";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/src/lib/useKeyboardShortcuts";
import { useBookmarks } from "@/src/context/BookmarksContext";
import { useWallet } from "@/src/context/WalletContext";
import ArchiveBanner from "@/components/ArchiveBanner";
import { getAllTags, getTagMap } from "@/src/lib/streamTags";
import PortfolioChart from "@/components/PortfolioChart";
import StreamExpiryAlerts from "@/components/StreamExpiryAlerts";
import PortfolioSummaryCard from "@/components/PortfolioSummaryCard";
import StreamPerformanceMetrics from "@/components/StreamPerformanceMetrics";
import WatchlistTab from "@/components/WatchlistTab";
import StreamCard from "@/components/StreamCard";
import ThemeToggle from "@/components/ThemeToggle";
import PullToRefresh from "@/components/PullToRefresh";

type DashboardState = "loading" | "filtered-empty" | "empty" | "ready";

type SortField = "created" | "endDate" | "amount" | "status";
type SortOrder = "asc" | "desc";

const VALID_SORT_FIELDS: SortField[] = ["created", "endDate", "amount", "status"];
const VALID_SORT_ORDERS: SortOrder[] = ["asc", "desc"];

function parseSortField(value: string | null): SortField {
  if (value && (VALID_SORT_FIELDS as string[]).includes(value)) {
    return value as SortField;
  }
  return "created";
}

function parseSortOrder(value: string | null): SortOrder {
  if (value && (VALID_SORT_ORDERS as string[]).includes(value)) {
    return value as SortOrder;
  }
  return "desc";
}

import { exportStreamsPdf } from "@/src/lib/pdfExport";

function DashboardContent() {
  const rpcFetch = useRpcFetch();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useToast();
  const { bookmarkedIds } = useBookmarks();
  const { address, streamRefreshTrigger, setActiveStreamCount } = useWallet();
  const [loading, setLoading] = useState(true);
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter states from URL params
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [tokenFilter, setTokenFilter] = useState(searchParams.get("token") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  // Date range filters — ISO date strings (YYYY-MM-DD), persisted in URL (#520)
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") || "");
  // Min/max stream rate filters in stroops/sec (#520)
  const [minRate, setMinRate] = useState(searchParams.get("minRate") || "");
  const [maxRate, setMaxRate] = useState(searchParams.get("maxRate") || "");
  // Tag filter — multiselect, client-side only
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Sort state — read from URL query string (?sort=amount&dir=desc).
  // Falls back to "created" / "desc" when params are absent or invalid.
  // Using URL params means browser back/forward navigation restores the sort.
  const [sortField, setSortField] = useState<SortField>(() =>
    parseSortField(searchParams.get("sort")),
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(() =>
    parseSortOrder(searchParams.get("dir")),
  );

  function handleSortFieldChange(field: SortField) {
    setSortField(field);
  }

  function toggleSortOrder() {
    const next: SortOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(next);
  }

  // Selection and bulk-action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [showBulkCancelConfirm, setShowBulkCancelConfirm] = useState(false);
  const [optimisticOps, setOptimisticOps] = useState<Record<string, { type: string; optimisticDeposit?: number; optimisticStatus?: string; optimisticClaimable?: number }>>({});

  // Pagination state (#383)
  const [visibleCount, setVisibleCount] = useState(12);
  const PAGE_SIZE = 12;

  // Tab state
  const [activeTab, setActiveTab] = useState<"streams" | "watchlist">("streams");

  // UI state
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(false);
  // When "asset", streams are grouped by their token; when "tag", by their tag label.
  const [groupBy, setGroupBy] = useState<"none" | "asset" | "tag">("none");
  // Track which tag groups are collapsed. Key = tag label, value = true when collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whether the filter bar is expanded (toggle with "f" shortcut)
  const [showFilterBar, setShowFilterBar] = useState(true);
  // Index of the currently keyboard-focused stream card (-1 = none)
  const [focusedStreamIndex, setFocusedStreamIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;

    // Flush cached data and reset search query immediately on disconnect/address change
    // so streams from a previous wallet session are never returned or mixed in.
    setStreams([]);
    setSearch("");
    setSelectedIds(new Set());
    if (!address) {
      setLoading(false);
      return;
    }

    setLoading(true);

    async function load() {
      try {
        const data = await rpcFetch(() =>
          Promise.resolve(getStreamsForWallet(address)),
        );
        if (!cancelled) {
          setStreams(data);
          setLastRefreshTime(Date.now());
        }
      } catch {
        // Errors are surfaced via toast by rpcFetch; leave streams empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();

    // Poll for claimable updates every 30s without resetting scroll position.
    pollRef.current = setInterval(async () => {
      try {
        const data = await rpcFetch(() =>
          Promise.resolve(watchClaimable(getStreamsForWallet(address))),
        );
        if (!cancelled) {
          setStreams(data);
          setLastRefreshTime(Date.now());
        }
      } catch {
        // silently keep current data
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, streamRefreshTrigger]);

  // Manual refresh ("r" shortcut / refresh event) — re-fetch without resetting filters.
  const refreshStreams = useCallback(async () => {
    if (!address) return;
    setIsRefreshing(true);
    try {
      const data = await rpcFetch(() =>
        Promise.resolve(getStreamsForWallet(address)),
      );
      setStreams(data);
      setLastRefreshTime(Date.now());
      addToast("Stream list refreshed.", "info");
    } catch {
      // Errors are surfaced via toast by rpcFetch.
    } finally {
      setIsRefreshing(false);
    }
  }, [address, rpcFetch, addToast]);

  useEffect(() => {
    const handler = () => void refreshStreams();
    window.addEventListener("sorostream:refresh-streams", handler);
    return () => window.removeEventListener("sorostream:refresh-streams", handler);
  }, [refreshStreams]);

  // Get unique tokens from streams for dropdown
  const uniqueTokens = useMemo(() => {
    const tokens = new Set(streams.map((s) => s.token));
    return Array.from(tokens).sort();
  }, [streams]);

  // Refresh all tags from localStorage whenever streams change
  useEffect(() => {
    setAllTags(getAllTags());
  }, [streams]);

  const filtered = useMemo(() => {
    const tagMap = selectedTags.length > 0 ? getTagMap() : null;
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : undefined;
    const toMs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : undefined;
    const minRateNum = minRate !== "" ? parseFloat(minRate) : undefined;
    const maxRateNum = maxRate !== "" ? parseFloat(maxRate) : undefined;
    return streams.filter((s) => {
      if (bookmarksOnly && !bookmarkedIds.has(s.id)) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (tokenFilter && s.token !== tokenFilter) return false;
      // Date range filter: compare stream creation date against from/to (#520)
      if (fromMs !== undefined) {
        const startMs = new Date(s.startTime).getTime();
        if (startMs < fromMs) return false;
      }
      if (toMs !== undefined) {
        const startMs = new Date(s.startTime).getTime();
        if (startMs > toMs) return false;
      }
      // Min/max rate filter — flowRate is in stroops/sec (#520)
      if (minRateNum !== undefined && s.flowRate < minRateNum) return false;
      if (maxRateNum !== undefined && s.flowRate > maxRateNum) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesSearch =
          s.sender.toLowerCase().includes(q) ||
          s.recipient.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (tagMap && selectedTags.length > 0) {
        const streamTags = tagMap[s.id] ?? [];
        const hasAllTags = selectedTags.every((t) => streamTags.includes(t));
        if (!hasAllTags) return false;
      }
      return true;
    });
  }, [streams, statusFilter, tokenFilter, search, bookmarksOnly, bookmarkedIds, selectedTags, dateFrom, dateTo, minRate, maxRate]);

  useEffect(() => {
    // Reset to page 1 when filters change
    setCurrentPage(1);
  }, [statusFilter, tokenFilter, search, bookmarksOnly, selectedTags, dateFrom, dateTo, minRate, maxRate]);

  // Sort filtered streams, pinning bookmarks first, then by the chosen sort field.
  const sortedFiltered = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Always pin bookmarks first
      const aB = bookmarkedIds.has(a.id) ? 0 : 1;
      const bB = bookmarkedIds.has(b.id) ? 0 : 1;
      if (aB !== bB) return aB - bB;

      switch (sortField) {
        case "created":
          return dir * (new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        case "endDate":
          return dir * (new Date(a.endTime).getTime() - new Date(b.endTime).getTime());
        case "amount":
          return dir * (a.deposit - b.deposit);
        case "status": {
          const order: Record<string, number> = { Active: 0, Paused: 1, Ended: 2, Cancelled: 3 };
          return dir * ((order[a.status] ?? 3) - (order[b.status] ?? 3));
        }
        default:
          return 0;
      }
    });
  }, [filtered, bookmarkedIds, sortField, sortOrder]);

  // Update URL params when filters or sort state change.
  // Sort is stored in ?sort=<field>&dir=<order> so that browser back/forward
  // navigation restores the previous sort state without touching localStorage.
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (tokenFilter) params.set("token", tokenFilter);
    if (search.trim()) params.set("search", search);
    // Date range filters (#520)
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    // Min/max rate filters (#520)
    if (minRate) params.set("minRate", minRate);
    if (maxRate) params.set("maxRate", maxRate);
    // Only write sort params when they differ from defaults to keep URLs clean.
    if (sortField !== "created") params.set("sort", sortField);
    if (sortOrder !== "desc") params.set("dir", sortOrder);

    const queryString = params.toString();
    const newPath = queryString ? `/dashboard?${queryString}` : "/dashboard";
    router.replace(newPath);
  }, [statusFilter, tokenFilter, search, sortField, sortOrder, dateFrom, dateTo, minRate, maxRate, router]);

  const clearFilters = () => {
    setStatusFilter("");
    setTokenFilter("");
    setSearch("");
    setBookmarksOnly(false);
    setSelectedTags([]);
    setDateFrom("");
    setDateTo("");
    setMinRate("");
    setMaxRate("");
    setVisibleCount(PAGE_SIZE);
  };

  const hasActiveFilters = !!(statusFilter || tokenFilter || search.trim() || bookmarksOnly || selectedTags.length > 0 || dateFrom || dateTo || minRate || maxRate);

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [statusFilter, tokenFilter, search, bookmarksOnly, selectedTags, dateFrom, dateTo, minRate, maxRate]);

  // Grouped view: bucket the (already filtered + sorted) streams by token.
  const assetGroups = useMemo(() => {
    if (groupBy !== "asset") return [];
    const map = new Map<string, StreamData[]>();
    for (const s of sortedFiltered) {
      const key = s.token || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([token, items]) => ({ token, items }));
  }, [groupBy, sortedFiltered]);

  // Grouped view: bucket streams by their tag labels.
  // Streams with no tags are placed into an "(Untagged)" group.
  const tagGroups = useMemo(() => {
    if (groupBy !== "tag") return [];
    const tagMap = getTagMap();
    const map = new Map<string, StreamData[]>();
    for (const s of sortedFiltered) {
      const tags = tagMap[s.id] ?? [];
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
    // Sort: named tags alphabetically first, then "(Untagged)" last.
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === "(Untagged)") return 1;
        if (b[0] === "(Untagged)") return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, items]) => ({ label, items }));
  }, [groupBy, sortedFiltered]);

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const state: DashboardState = loading
    ? "loading"
    : sortedFiltered.length > 0
    ? "ready"
    : streams.length > 0 || hasActiveFilters
    ? "filtered-empty"
    : "empty";

  const allFilteredSelected = useMemo(
    () => filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id)),
    [filtered, selectedIds],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.id)));
    }
  }, [allFilteredSelected, filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Keep the wallet context informed of how many streams are still active so
  // it can warn before disconnecting (#397).
  useEffect(() => {
    setActiveStreamCount(streams.filter((s) => s.status === "Active").length);
  }, [streams, setActiveStreamCount]);

  // Clone a stream by pre-filling the create form with its parameters (#393).
  const handleClone = useCallback(
    (id: string) => {
      const s = streams.find((x) => x.id === id);
      if (!s) return;
      const duration = Math.round(
        (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000,
      );
      const qp = new URLSearchParams({
        recipient: s.recipient,
        amount: (s.deposit / 10_000_000).toString(),
        token: s.token,
        duration: String(duration),
        cliff: "0",
      });
      router.push(`/stream/new?${qp.toString()}`);
    },
    [streams, router],
  );

  const handleBulkCancel = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Apply optimistic updates immediately
    const prevOps = { ...optimisticOps };
    const newOps = { ...prevOps };
    ids.forEach((id) => {
      newOps[id] = { type: "cancel", optimisticStatus: "Cancelled" };
    });
    setOptimisticOps(newOps);
    setBulkLoading(true);

    try {
      await Promise.all(ids.map((id) => sorostream.cancelStream(id)));
      addToast(`Cancelled ${ids.length} stream(s) successfully.`, "success");
      const data = await rpcFetch(() => Promise.resolve(getStreamsForWallet(address)));
      setStreams(data);
      clearSelection();
      setShowBulkCancelConfirm(false);
      // Clear optimistic overrides once data is refreshed
      setOptimisticOps((current) => {
        const next = { ...current };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    } catch (err) {
      // Roll back optimistic state on failure
      setOptimisticOps(prevOps);
      addToast("Bulk cancel failed. Please try again.", "error");
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, optimisticOps, addToast, rpcFetch, clearSelection, address]);

  const handleBulkTopUp = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Apply optimistic top-up immediately
    const prevOps = { ...optimisticOps };
    const newOps = { ...prevOps };
    ids.forEach((id) => {
      const currentStream = streams.find((s) => s.id === id);
      const currentDeposit = currentStream?.deposit ?? 0;
      newOps[id] = { type: "top-up", optimisticDeposit: currentDeposit + 100_000_000 };
    });
    setOptimisticOps(newOps);
    setBulkLoading(true);

    try {
      await Promise.all(ids.map((id) => sorostream.topUp(id)));
      addToast(`Topped up ${ids.length} stream(s) successfully.`, "success");
      const data = await rpcFetch(() => Promise.resolve(getStreamsForWallet(address)));
      setStreams(data);
      clearSelection();
      setOptimisticOps((current) => {
        const next = { ...current };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    } catch {
      // Roll back on failure
      setOptimisticOps(prevOps);
      addToast("Bulk top-up failed. Please try again.", "error");
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, optimisticOps, streams, addToast, rpcFetch, clearSelection, address]);

  const handleBulkExport = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Strip synthesised entries — only export real on-chain history. Mock
    // entries carry fabricated txHashes and must never appear in CSV exports.
    const allEntries = ids
      .flatMap((id) => getMockStreamHistory(id))
      .filter((e) => !e.isMock);
    if (allEntries.length === 0) {
      addToast("No verified transaction history is available for the selected streams yet.", "info");
      return;
    }
    downloadCSV(allEntries, `bulk-${ids.length}-streams`);
    addToast(`Exported history for ${ids.length} stream(s).`, "success");
  }, [selectedIds, addToast]);

  const handleExportPdf = useCallback(() => {
    const targets = selectedIds.size > 0
      ? streams.filter((s) => selectedIds.has(s.id))
      : sortedFiltered.length > 0
      ? sortedFiltered
      : streams;

    if (targets.length === 0) {
      addToast("No streams available to export.", "info");
      return;
    }

    const { filename } = exportStreamsPdf(targets, address);
    addToast(`Exported PDF report: ${filename}`, "success");
  }, [selectedIds, streams, sortedFiltered, address, addToast]);

  const shortcutGroups: ShortcutGroup[] = useMemo(() => [
    {
      title: "Dashboard",
      shortcuts: [
        { key: "n", description: "New stream", action: () => router.push("/stream/new") },
        { key: "r", description: "Refresh list", action: () => void refreshStreams() },
        { key: "/", description: "Focus search", action: () => searchRef.current?.focus(), ignoreWhenEditing: false },
        { key: "f", description: "Toggle filter bar", action: () => setShowFilterBar((v) => !v) },
        {
          key: "j",
          description: "Next stream",
          action: () => {
            if (sortedFiltered.length === 0) return;
            setFocusedStreamIndex((i) => {
              const next = i < sortedFiltered.length - 1 ? i + 1 : 0;
              return next;
            });
          },
        },
        {
          key: "k",
          description: "Previous stream",
          action: () => {
            if (sortedFiltered.length === 0) return;
            setFocusedStreamIndex((i) => {
              const prev = i > 0 ? i - 1 : sortedFiltered.length - 1;
              return prev;
            });
          },
        },
        {
          key: "Enter",
          description: "Open focused stream",
          action: () => {
            if (focusedStreamIndex >= 0 && focusedStreamIndex < sortedFiltered.length) {
              router.push(`/stream/${sortedFiltered[focusedStreamIndex].id}`);
            }
          },
        },
        { key: "Escape", description: "Clear search / selection", action: () => { setSearch(""); clearSelection(); setFocusedStreamIndex(-1); (document.activeElement as HTMLElement)?.blur(); } },
        { key: "?", shift: true, description: "Toggle keyboard shortcuts help", action: () => setShowShortcutsHelp((v) => !v) },
      ],
    },
  ], [router, clearSelection, refreshStreams, sortedFiltered, focusedStreamIndex]);

  useKeyboardShortcuts(shortcutGroups);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const result = downloadWalletStreamsCsv(streams, address);
                addToast(`Exported ${result.rowCount} stream${result.rowCount === 1 ? "" : "s"} to ${result.filename}`, "success");
              }}
              disabled={!address || streams.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              Export CSV
            </button>
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode);
                if (!multiSelectMode) {
                  // Entering multi-select mode - clear selection
                  setSelectedIds(new Set());
                }
              }}
              aria-pressed={multiSelectMode}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                multiSelectMode
                  ? "bg-blue-700 text-white hover:bg-blue-800 focus-visible:ring-blue-500"
                  : "border border-gray-700 text-gray-300 hover:bg-gray-800 focus-visible:ring-green-500"
              }`}
            >
              {multiSelectMode ? "✓ Select Multiple" : "Select Multiple"}
            </button>
            <Link
              href="/stream/new"
              className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              + Create Stream
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            {/* Portfolio summary */}
            {address && (
              <PortfolioSummaryCard streams={streams} walletAddress={address} />
            )}

            {/* Wallet-scoped analytics (#521) */}
            {address && streams.length > 0 && (
              <div className="mb-6">
                <details className="group" open>
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-300 hover:text-white py-2 select-none list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded">
                    <span
                      className="transition-transform duration-200 group-open:rotate-90"
                      aria-hidden="true"
                    >
                      ▶
                    </span>
                    Wallet Analytics
                    <span className="ml-1 text-xs font-normal text-gray-500">(last 30 days)</span>
                  </summary>
                  <div className="mt-3">
                    <StreamErrorBoundary section="Wallet Analytics">
                      <WalletAnalyticsDashboard streams={streams} walletAddress={address} />
                    </StreamErrorBoundary>
                  </div>
                </details>
              </div>
            )}

            {/* Aggregated performance metrics (#419) */}
            <StreamErrorBoundary section="Performance Metrics">
              <StreamPerformanceMetrics streams={streams} walletAddress={address} />
            </StreamErrorBoundary>

            {/* Tab switcher */}
            <div className="flex rounded-xl bg-gray-800 p-1 mb-6" role="tablist" aria-label="Dashboard view">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "streams"}
                onClick={() => setActiveTab("streams")}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                  activeTab === "streams" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                My Streams
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "watchlist"}
                onClick={() => setActiveTab("watchlist")}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                  activeTab === "watchlist" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Watchlist
              </button>
            </div>

            {activeTab === "watchlist" ? (
              <div role="tabpanel" aria-label="Watchlist">
                <WatchlistTab />
              </div>
            ) : (
            <div role="tabpanel" aria-label="My Streams">

            {/* Archive banner — shown when streams have been auto-archived */}
            <ArchiveBanner />

            {/* Expiry alerts — amber/red banners for streams expiring within 24h / 1h */}
            {address && (
              <StreamExpiryAlerts streams={streams} currentAddress={address} />
            )}

            {/* Status legend */}
            <StreamErrorBoundary section="Stats Summary">
              <StatusLegend />
            </StreamErrorBoundary>

            {/* Filter Bar */}
            <div className="mb-6 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowFilterBar((v) => !v)}
                  aria-expanded={showFilterBar}
                  aria-controls="filter-bar-content"
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                >
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200"
                    style={{ display: "inline-block", transform: showFilterBar ? "rotate(0deg)" : "rotate(-90deg)" }}
                  >
                    ▼
                  </span>
                  Filters
                  {hasActiveFilters && (
                    <span className="ml-1 bg-green-800 text-green-300 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                      active
                    </span>
                  )}
                  <kbd className="hidden sm:inline-flex ml-1 bg-gray-700 text-gray-400 text-[10px] px-1 rounded font-mono">F</kbd>
                </button>
              </div>
              {showFilterBar && (
              <div id="filter-bar-content">
              <div className="flex flex-wrap gap-3">
                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  aria-label="Filter by status"
                >
                  <option value="">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Paused">Paused</option>
                  <option value="Ended">Ended</option>
                  <option value="Cancelled">Cancelled</option>
                </select>

                {/* Token Filter */}
                <select
                  value={tokenFilter}
                  onChange={(e) => setTokenFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  aria-label="Filter by token"
                  disabled={uniqueTokens.length === 0}
                >
                  <option value="">All Tokens</option>
                  {uniqueTokens.map((token) => (
                    <option key={token} value={token}>
                      {token}
                    </option>
                  ))}
                </select>

                {/* Date range filter (#520) */}
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-400 whitespace-nowrap" htmlFor="filter-date-from">
                    From
                  </label>
                  <input
                    id="filter-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 [color-scheme:dark]"
                    aria-label="Filter streams created from date"
                  />
                  <label className="text-xs text-gray-400 whitespace-nowrap" htmlFor="filter-date-to">
                    To
                  </label>
                  <input
                    id="filter-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 [color-scheme:dark]"
                    aria-label="Filter streams created to date"
                  />
                </div>

                {/* Min/max rate filter — stroops/sec (#520) */}
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-400 whitespace-nowrap" htmlFor="filter-min-rate">
                    Rate
                  </label>
                  <input
                    id="filter-min-rate"
                    type="number"
                    value={minRate}
                    onChange={(e) => setMinRate(e.target.value)}
                    placeholder="Min"
                    min="0"
                    step="1"
                    className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                    aria-label="Minimum stream rate (stroops/sec)"
                  />
                  <span className="text-xs text-gray-500">–</span>
                  <input
                    id="filter-max-rate"
                    type="number"
                    value={maxRate}
                    onChange={(e) => setMaxRate(e.target.value)}
                    placeholder="Max"
                    min="0"
                    step="1"
                    className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                    aria-label="Maximum stream rate (stroops/sec)"
                  />
                  <span className="text-xs text-gray-500">stroops/s</span>
                </div>

                {/* Bookmarks only toggle */}
                <button
                  onClick={() => setBookmarksOnly((v) => !v)}
                  aria-pressed={bookmarksOnly}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                    bookmarksOnly
                      ? "border-yellow-500 text-yellow-400 bg-yellow-900/20"
                      : "border-gray-700 text-gray-400 hover:bg-gray-800"
                  }`}
                >
                  <span aria-hidden="true">{bookmarksOnly ? "★" : "☆"}</span>
                  Bookmarks
                </button>

                {/* Tag filter — shown only when tags exist */}
                {allTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs text-gray-400">Tags:</span>
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag],
                          )
                        }
                        aria-pressed={selectedTags.includes(tag)}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                          selectedTags.includes(tag)
                            ? "bg-green-900/60 border-green-600 text-green-300"
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-300"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Search Input */}
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by recipient, sender, or ID…"
                  className="flex-1 min-w-0 w-full sm:min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  aria-label="Search streams"
                />

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Active Filters Display */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                  {statusFilter && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      Status: {statusFilter}
                    </span>
                  )}
                  {tokenFilter && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      Token: {tokenFilter}
                    </span>
                  )}
                  {dateFrom && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      From: {dateFrom}
                    </span>
                  )}
                  {dateTo && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      To: {dateTo}
                    </span>
                  )}
                  {minRate && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      Rate ≥ {minRate}
                    </span>
                  )}
                  {maxRate && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      Rate ≤ {maxRate}
                    </span>
                  )}
                  {search.trim() && (
                    <span className="bg-gray-800 px-2 py-1 rounded">
                      Search: &quot;{search}&quot;
                    </span>
                  )}
                  {bookmarksOnly && (
                    <span className="bg-yellow-900/30 text-yellow-400 px-2 py-1 rounded">
                      ★ Bookmarks only
                    </span>
                  )}
                  {selectedTags.length > 0 && (
                    <span className="bg-green-900/30 text-green-400 px-2 py-1 rounded">
                      Tags: {selectedTags.join(", ")}
                    </span>
                  )}
                </div>
              )}
              </div>
              )}
            </div>

            {/* Sort controls */}
            <div className="mb-4 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-xs text-gray-400 mr-1 whitespace-nowrap">Sort by:</span>
              {(
                [
                  { value: "created", label: "Date Created" },
                  { value: "endDate", label: "End Date" },
                  { value: "amount",  label: "Amount" },
                  { value: "status",  label: "Status" },
                ] as { value: SortField; label: string }[]
              ).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleSortFieldChange(value)}
                  aria-pressed={sortField === value}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                    sortField === value
                      ? "bg-green-700 border-green-600 text-white"
                      : "border-gray-700 text-gray-400 hover:bg-gray-800"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={toggleSortOrder}
                aria-label={`Sort order: ${sortOrder === "asc" ? "ascending" : "descending"}`}
                className="ml-1 px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {sortOrder === "asc" ? "↑ Asc" : "↓ Desc"}
              </button>
              <button
                onClick={() => setGroupBy((g) => (g === "asset" ? "none" : "asset"))}
                aria-pressed={groupBy === "asset"}
                className={`ml-1 px-3 py-1.5 rounded-lg text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                  groupBy === "asset"
                    ? "bg-green-700 border-green-600 text-white"
                    : "border-gray-700 text-gray-400 hover:bg-gray-800"
                }`}
              >
                Group by asset
              </button>
              <button
                onClick={() => setGroupBy((g) => (g === "tag" ? "none" : "tag"))}
                aria-pressed={groupBy === "tag"}
                className={`ml-1 px-3 py-1.5 rounded-lg text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
                  groupBy === "tag"
                    ? "bg-green-700 border-green-600 text-white"
                    : "border-gray-700 text-gray-400 hover:bg-gray-800"
                }`}
              >
                Group by tag
              </button>
            </div>{/* end sort inner flex */}
            </div>{/* end sort overflow wrapper */}

            {/* Bulk actions bar */}
            {selectedIds.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 accent-green-500"
                    aria-label="Select all visible streams"
                  />
                  {selectedIds.size} selected
                </label>
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={handleBulkExport}
                    disabled={bulkLoading}
                    className="px-3 py-1.5 text-xs bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={handleExportPdf}
                    disabled={bulkLoading}
                    data-testid="bulk-export-pdf-button"
                    className="px-3 py-1.5 text-xs bg-green-800 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    Export PDF
                  </button>
                  <button
                    onClick={handleBulkTopUp}
                    disabled={bulkLoading}
                    className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    {bulkLoading ? "…" : "Top-up All"}
                  </button>
                  <button
                    onClick={() => setShowBulkCancelConfirm(true)}
                    disabled={bulkLoading}
                    className="px-3 py-1.5 text-xs bg-red-700 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    {bulkLoading ? "…" : "Cancel All"}
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    aria-label="Clear selection"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <StreamErrorBoundary section="Stream List">
            <PullToRefresh onRefresh={refreshStreams}>
            {state === "loading" ? (
              <div
                className="rounded-xl border border-gray-700 bg-gray-900 p-2"
                role="status"
                aria-busy="true"
                aria-label="Loading streams"
              >
                <ul className="grid gap-4 sm:grid-cols-1 md:grid-cols-2" role="list">
                  {Array.from({ length: 6 }, (_, index) => (
                    <li key={index}>
                      <SkeletonCard />
                    </li>
                  ))}
                </ul>
              </div>
            ) : state === "empty" ? (
              <div className="bg-gray-800 rounded-xl p-10 text-center flex flex-col items-center gap-4">
                <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="60" cy="60" r="56" fill="#1f2937" stroke="#374151" strokeWidth="2" />
                  <path d="M40 75 Q60 45 80 75" stroke="#10b981" strokeWidth="3" strokeLinecap="round" fill="none" />
                  <circle cx="40" cy="75" r="4" fill="#10b981" />
                  <circle cx="60" cy="55" r="4" fill="#10b981" />
                  <circle cx="80" cy="75" r="4" fill="#10b981" />
                  <path d="M52 88 L68 88" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" />
                  <path d="M55 93 L65 93" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="60" cy="35" r="6" fill="#374151" />
                  <path d="M57 35 L63 35 M60 32 L60 38" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <h2 className="text-xl font-semibold text-white">No streams yet</h2>
                <p className="text-gray-400 text-sm max-w-xs">Create your first payment stream to get started</p>
                <Link
                  href="/stream/new"
                  className="mt-2 inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
                >
                  + Create Stream
                </Link>
              </div>
            ) : state === "filtered-empty" ? (
              <div className="bg-gray-800 rounded-xl p-10 text-center flex flex-col items-center gap-4">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="40" cy="40" r="36" fill="#1f2937" stroke="#374151" strokeWidth="2" />
                  <circle cx="36" cy="36" r="14" stroke="#6b7280" strokeWidth="3" fill="none" />
                  <path d="M46 46 L56 56" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
                  <path d="M32 36 L40 36 M36 32 L36 40" stroke="#374151" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <h2 className="text-lg font-semibold text-white">No results found</h2>
                <p className="text-gray-400 text-sm">No streams match your current filters</p>
                {bookmarksOnly ? (
                  <button
                    onClick={() => setBookmarksOnly(false)}
                    className="text-yellow-400 hover:text-yellow-300 text-sm"
                  >
                    Show all streams
                  </button>
                ) : (
                  <button
                    onClick={clearFilters}
                    className="mt-1 text-green-400 hover:text-green-300 text-sm"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : groupBy === "asset" ? (
              <div className="space-y-6">
                {assetGroups.map(({ token, items }) => (
                  <section key={token} aria-label={`Streams in ${token}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-white">{token}</h3>
                      <span className="text-xs text-gray-400 bg-gray-800 rounded-full px-2 py-0.5">
                        {items.length}
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-700 bg-gray-900 p-2">
                      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                        {items.map((s) => (
                          <div key={s.id} className="relative">
                            <Link href={`/stream/${s.id}`} className="block">
                              <StreamCard
                                id={s.id}
                                sender={s.sender}
                                recipient={s.recipient}
                                flowRate={s.flowRate}
                                deposit={s.deposit}
                                status={s.status}
                                selected={multiSelectMode ? selectedIds.has(s.id) : false}
                                onToggle={multiSelectMode ? toggleSelect : undefined}
                                onClone={handleClone}
                                scheduledStartTime={s.scheduledStartTime}
                                startTime={s.startTime}
                                endTime={s.endTime}
                                token={s.token}
                              />
                            </Link>
                          </div>
                        ))}
                       </div>
                    </div>
                  </section>
                  );
                })}
              </div>
            ) : groupBy === "tag" ? (
              <div className="space-y-6">
                {tagGroups.map(({ label, items }) => {
                  const isCollapsed = collapsedGroups[label] ?? false;
                  const activeCount = items.filter((s) => s.status === "Active").length;
                  return (
                    <section key={label} aria-label={`Streams tagged ${label}`}>
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(label)}
                        className="flex items-center gap-2 mb-3 w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                        aria-expanded={!isCollapsed}
                      >
                        <span
                          className="text-gray-400 transition-transform duration-200 text-xs"
                          aria-hidden="true"
                          style={{ display: "inline-block", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                        >
                          ▼
                        </span>
                        <h3 className="text-sm font-semibold text-white group-hover:text-green-300 transition-colors">
                          {label}
                        </h3>
                        <span
                          className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5"
                          title={`${items.length} stream${items.length !== 1 ? "s" : ""} total`}
                        >
                          {items.length}
                        </span>
                        {activeCount > 0 && (
                          <span
                            className="text-xs bg-green-900/60 text-green-400 border border-green-700/50 rounded-full px-2 py-0.5"
                            title={`${activeCount} active`}
                          >
                            {activeCount} active
                          </span>
                        )}
                      </button>
                      {!isCollapsed && (
                        <div className="rounded-xl border border-gray-700 bg-gray-900 p-2">
                          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                            {items.map((s) => (
                              <div key={s.id} className="relative">
                                <Link href={`/stream/${s.id}`} className="block">
                                  <StreamCard
                                    id={s.id}
                                    sender={s.sender}
                                    recipient={s.recipient}
                                    flowRate={s.flowRate}
                                    deposit={s.deposit}
                                    status={s.status}
                                    selected={multiSelectMode ? selectedIds.has(s.id) : false}
                                    onToggle={multiSelectMode ? toggleSelect : undefined}
                                    onClone={handleClone}
                                    scheduledStartTime={s.scheduledStartTime}
                                    startTime={s.startTime}
                                    endTime={s.endTime}
                                  />
                                </Link>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-700 bg-gray-900 p-2">
                <StreamVirtualList
                  streams={sortedFiltered.slice(0, visibleCount)}
                  selectedIds={multiSelectMode ? selectedIds : undefined}
                  onToggleSelect={multiSelectMode ? toggleSelect : undefined}
                  onClone={handleClone}
                  focusedStreamId={focusedStreamIndex >= 0 && focusedStreamIndex < sortedFiltered.length ? sortedFiltered[focusedStreamIndex].id : undefined}
                  optimisticOps={optimisticOps}
                />
                <div className="flex justify-between items-center p-4">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => p - 1)}
                    className="px-4 py-2 bg-gray-800 text-white rounded disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-400">
                    Page {currentPage} of {Math.ceil(sortedFiltered.length / pageSize) || 1}
                  </span>
                  <button 
                    disabled={currentPage >= Math.ceil(sortedFiltered.length / pageSize)}
                    onClick={() => setCurrentPage(p => p + 1)}
                    className="px-4 py-2 bg-gray-800 text-white rounded disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </PullToRefresh>
            </StreamErrorBoundary>

            {/* Pagination: Load More (#383) */}
            {sortedFiltered.length > visibleCount && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-6 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                >
                  Load More ({Math.min(PAGE_SIZE, sortedFiltered.length - visibleCount)} of {sortedFiltered.length - visibleCount} remaining)
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  Showing {Math.min(visibleCount, sortedFiltered.length)} of {sortedFiltered.length} streams
                </p>
              </div>
            )}
            {sortedFiltered.length > 0 && sortedFiltered.length <= visibleCount && (
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-500">
                  All {sortedFiltered.length} stream{sortedFiltered.length === 1 ? "" : "s"} loaded
                </p>
              </div>
            )}
            </div>
            )}{/* end activeTab conditional */}
          </div>

          <div className="w-full lg:w-80 shrink-0">
            <StreamErrorBoundary section="Activity Feed">
              <StreamEventFeed />
            </StreamErrorBoundary>
          </div>
        </div>
      </div>

      <KeyboardShortcutsHelp
        open={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        groups={shortcutGroups}
      />

      {/* Bulk cancel confirmation modal */}
      {showBulkCancelConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full border border-red-700">
            <div className="bg-red-900/40 border-b border-red-700 p-6">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg
                    className="h-6 w-6 text-red-400"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 4 21 4 23 6 23 20a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6" />
                    <line x1="10" y1="11" x2="14" y2="17" />
                    <line x1="14" y1="11" x2="10" y2="17" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Cancel {selectedIds.size} Stream{selectedIds.size !== 1 ? "s" : ""}?
                  </h2>
                  <p className="text-xs text-red-300 mt-1">
                    This action cannot be undone. Unstreamed funds will be returned.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-300">
                You are about to cancel {selectedIds.size} stream{selectedIds.size !== 1 ? "s" : ""}. Are you sure?
              </p>

              {selectedIds.size > 0 && selectedIds.size <= 10 && (
                <div className="bg-gray-700/50 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Streams to cancel:</p>
                  <ul className="space-y-1 text-xs text-gray-300">
                    {Array.from(selectedIds).map((id) => {
                      const stream = filtered.find((s) => s.id === id);
                      return (
                        <li key={id} className="flex items-center gap-2">
                          <span className="text-gray-500">#{id}</span>
                          {stream && (
                            <>
                              <span className="text-gray-600">→</span>
                              <span className="truncate">{stream.recipient}</span>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {selectedIds.size > 10 && (
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-300">
                    {selectedIds.size} streams selected
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-gray-700 p-6 flex gap-3">
              <button
                onClick={() => setShowBulkCancelConfirm(false)}
                disabled={bulkLoading}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Keep Streams
              </button>
              <button
                onClick={handleBulkCancel}
                disabled={bulkLoading}
                className="flex-1 bg-red-700 text-white py-2 rounded-lg hover:bg-red-800 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 inline-flex items-center justify-center gap-2"
              >
                {bulkLoading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Cancelling…
                  </>
                ) : (
                  "Yes, Cancel All"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<StreamListSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useFocusTrap } from "@/src/lib/useFocusTrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LiveCounter from "@/components/LiveCounter";
import FiatDisplay from "@/components/FiatDisplay";
import FederationName from "@/components/FederationName";
import StreamTimeline from "@/components/StreamTimeline";
import CountdownTimer from "@/components/CountdownTimer";
import StreamProgressBar from "@/components/StreamProgressBar";
import VestingChart from "@/components/VestingChart";
import StreamHistory from "@/components/StreamHistory";
import { StreamErrorBoundary } from "@/components/StreamErrorBoundary";
import StreamCompletedBanner from "@/components/StreamCompletedBanner";
import { SkeletonDetail } from "@/components/Skeleton";
import WalletConnect from "@/components/WalletConnect";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import TransactionExportButton from "@/components/TransactionExportButton";
import StreamHealthBadge, {
  calculateHealthScore,
  getHealthTier,
} from "@/components/StreamHealthBadge";
import StreamHealthCard from "@/components/StreamHealthCard";
import CollateralUnlockBadge from "@/components/CollateralUnlockBadge";
import { type StreamHistoryEntry } from "@/src/lib/export";
import {
  sorostream,
  type StreamData,
  getMockStreamHistory,
  claimableNow,
  getMockStream,
  toStroops,
  getStreamsForWallet,
  getStreamMemo,
} from "@/src/lib/sorostream";
import { useToast } from "@/src/lib/toast";
import StreamQrModal from "@/components/StreamQrModal";
import WithdrawConfirmModal from "@/components/WithdrawConfirmModal";
import StartCountdownTimer from "@/components/StartCountdownTimer";
import EmbedWidgetModal from "@/components/EmbedWidgetModal";
import StreamComparisonModal from "@/components/StreamComparisonModal";
import StreamTagEditor from "@/components/StreamTagEditor";
import { getGiftMessage } from "@/components/GiftStreamModal";
import { useSettings } from "@/src/context/SettingsContext";
import { formatStellarAmount } from "@/src/lib/sorostream";
import { useTranslations } from "@/src/lib/i18n";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/src/lib/useKeyboardShortcuts";
import { useBookmarks } from "@/src/context/BookmarksContext";
import { useWallet } from "@/src/context/WalletContext";
import {
  generateTwitterShareUrl,
  generateLinkedInShareUrl,
  generateCopyLinkUrl,
  generateReadOnlyShareUrl,
} from "@/src/lib/share";
import StreamShareButtons from "@/components/StreamShareButtons";
import StreamCloneModal from "@/components/StreamCloneModal";
import StreamAnalyticsCharts from "@/components/StreamAnalyticsCharts";

/** Grace period in seconds before a cancel is submitted on-chain. */
const CANCEL_GRACE_SECONDS = 5;

/** Timeout in milliseconds for the stream data fetch. */
const STREAM_FETCH_TIMEOUT_MS = 10_000;

/**
 * A valid stream ID is a non-empty string of up to 32 word characters
 * (letters, digits, underscores, hyphens).  Anything outside this set
 * (e.g. path traversal characters, SQL injection fragments) is rejected
 * immediately without making a network call.
 */
const STREAM_ID_REGEX = /^[\w-]{1,32}$/;

function isValidStreamId(id: string): boolean {
  return STREAM_ID_REGEX.test(id);
}

/** Spinner used inside transaction buttons */
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 inline-block mr-1.5 align-middle"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

const DEEP_LINK_KEY = "sorostream-deep-link";
const DEEP_LINK_COUNT_KEY = "sorostream-deep-link-count";

/**
 * Copies text to the clipboard, falling back to a hidden textarea +
 * execCommand for browsers without the async clipboard API.
 * Never rejects — failures are swallowed after attempting the fallback.
 */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      /* ignore */
    });
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function StreamDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { addToast, upsertPersistentToast, removeToast } = useToast();
  const { withdrawThreshold } = useSettings();
  const { address, refetchBalance, triggerStreamRefresh } = useWallet();
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const t = useTranslations("stream_detail");
  const [withdrawConfirmAmount, setWithdrawConfirmAmount] = useState<string | null>(null);

  // ── Stream data ────────────────────────────────────────────────────────────
  const [stream, setStream] = useState<StreamData | null>(null);
  const streamRef = useRef<StreamData | null>(null);
  streamRef.current = stream;
  const [historyEntries, setHistoryEntries] = useState<StreamHistoryEntry[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [routeError, setRouteError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  // ── Action loading states ──────────────────────────────────────────────────
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  /** True while the 5-second cancel grace period is active. */
  const [cancelPending, setCancelPending] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const cancelModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cancelModalRef, showCancelModal);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);

  // ── Pause / Resume states ──────────────────────────────────────────────────
  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  /** Optimistic status applied while a pause/resume tx is in-flight. */
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const pauseModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(pauseModalRef, showPauseModal);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const resumeModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(resumeModalRef, showResumeModal);

  // ── Schedule pause (future auto-pause) states ───────────────────────────────
  const [showSchedulePauseModal, setShowSchedulePauseModal] = useState(false);
  const [pauseAtInput, setPauseAtInput] = useState("");
  const [schedulePauseLoading, setSchedulePauseLoading] = useState(false);
  const schedulePauseModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(schedulePauseModalRef, showSchedulePauseModal);

  // ── Transfer recipient states ──────────────────────────────────────────────
  const [showTransferModal, setShowTransferModal] = useState(false);
  const transferModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(transferModalRef, showTransferModal);
  const [transferRecipientAddress, setTransferRecipientAddress] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState("");

  // ── Stream completion states ───────────────────────────────────────────────
  const [claimFinalLoading, setClaimFinalLoading] = useState(false);
  const [claimFinalDone, setClaimFinalDone] = useState(false);

  // ── Gift message (stored in localStorage by GiftStreamModal) ──────────────
  const [giftMessage, setGiftMessage] = useState<string | null>(null);
  useEffect(() => {
    const msg = getGiftMessage(params.id);
    if (msg) setGiftMessage(msg);
  }, [params.id]);

  // ── Top-up form state ──────────────────────────────────────────────────────
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpLoading, setTopUpLoading] = useState(false);

  // ── Clone modal ────────────────────────────────────────────────────────────
  const [showCloneModal, setShowCloneModal] = useState(false);

  // ── Save Template modal ────────────────────────────────────────────────────
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);

  // ── Success banner (stream just created) ──────────────────────────────────
  const [successPhase, setSuccessPhase] = useState<"in" | "out" | null>(null);

  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(event.target as Node)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Stream comparison modal state ──────────────────────────────────────────
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [allStreams, setAllStreams] = useState<StreamData[]>([]);

  // ── Milestone tracking & push notifications (#358) ───────────────────────────
  const firedMilestonesRef = useRef<Set<number>>(new Set());
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`sorostream_milestones_push_${params.id}`) === "true";
  });

  const handleTogglePushNotifications = async () => {
    if (!pushNotificationsEnabled) {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            addToast("Notification permission denied by browser.", "info");
            return;
          }
        } else if (Notification.permission === "denied") {
          addToast("Browser notifications are blocked in settings.", "error");
          return;
        }
      }
      setPushNotificationsEnabled(true);
      if (typeof window !== "undefined") {
        localStorage.setItem(`sorostream_milestones_push_${params.id}`, "true");
      }
      addToast("Milestone push notifications enabled.", "success");
    } else {
      setPushNotificationsEnabled(false);
      if (typeof window !== "undefined") {
        localStorage.setItem(`sorostream_milestones_push_${params.id}`, "false");
      }
      addToast("Milestone push notifications disabled.", "info");
    }
  };

  // ── Optimistic UI state ────────────────────────────────────────────────────
  /**
   * optimisticClaimable — passed to LiveCounter:
   *   null  → live ticking
   *   0     → immediately after withdraw click (pending tx)
   *
   * optimisticDeposit — shown next to stream balance:
   *   null  → use stream.deposit
   *   n     → optimistic value while top-up tx is in-flight
   */
  const [optimisticClaimable, setOptimisticClaimable] = useState<number | null>(null);
  const [optimisticDeposit, setOptimisticDeposit] = useState<number | null>(null);

  // ── Grace-period timer refs ────────────────────────────────────────────────
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelToastIdRef = useRef<number | null>(null);
  const undoRef = useRef(false);

  /** Clean up timers on unmount. */
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    };
  }, []);

  // ── Success banner: triggered once by ?new=true, blocked on refresh via sessionStorage ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "true") return;

    const sessionKey = `sorostream-new-banner-shown`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");

    // Remove query param so refresh doesn't retrigger
    const clean = new URL(window.location.href);
    clean.searchParams.delete("new");
    window.history.replaceState({}, "", clean.toString());

    setSuccessPhase("in");
    const outTimer = setTimeout(() => setSuccessPhase("out"), 1700);
    const doneTimer = setTimeout(() => setSuccessPhase(null), 2000);
    return () => { clearTimeout(outTimer); clearTimeout(doneTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep link: store URL when unauthenticated, redirect back after connect ──
  useEffect(() => {
    if (address === null) {
      // Store the intended URL (once per redirect cycle, max 1)
      const count = parseInt(sessionStorage.getItem(DEEP_LINK_COUNT_KEY) ?? "0", 10);
      if (count < 1) {
        sessionStorage.setItem(DEEP_LINK_KEY, window.location.pathname + window.location.search);
        sessionStorage.setItem(DEEP_LINK_COUNT_KEY, String(count + 1));
      }
    } else {
      // Wallet just connected — redirect to the stored deep link if it's different
      const stored = sessionStorage.getItem(DEEP_LINK_KEY);
      sessionStorage.removeItem(DEEP_LINK_KEY);
      sessionStorage.removeItem(DEEP_LINK_COUNT_KEY);
      if (stored && stored !== window.location.pathname + window.location.search) {
        router.push(stored);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Milestone detection effect: fires toast once per milestone per session
  useEffect(() => {
    if (!stream || stream.status === "Cancelled") return;

    const checkMilestones = () => {
      const start = new Date(stream.startTime).getTime();
      const end = new Date(stream.endTime).getTime();
      const now = Date.now();
      const totalDuration = end - start;
      if (totalDuration <= 0) return;

      const elapsed = now - start;
      const currentPct = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));

      const milestones = [25, 50, 75];
      for (const m of milestones) {
        if (currentPct >= m && !firedMilestonesRef.current.has(m)) {
          firedMilestonesRef.current.add(m);
          addToast(`🎉 Milestone reached: Stream #${stream.id} is ${m}% completed!`, "success");

          // Opt-in browser push notification when tab is not active
          if (
            pushNotificationsEnabled &&
            typeof window !== "undefined" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            try {
              new Notification("Milestone Reached! 🎉", {
                body: `Stream #${stream.id} has crossed ${m}% completion.`,
              });
            } catch {
              // Ignore push errors
            }
          }
        }
      }
    };

    checkMilestones();
    const interval = setInterval(checkMilestones, 1000);
    return () => clearInterval(interval);
  }, [stream, addToast, pushNotificationsEnabled]);

  // ── Clear stream data on wallet disconnect (#525) ─────────────────────────
  // When the wallet disconnects (address becomes null), immediately flush the
  // stream state so stale data from the previous session is never shown to a
  // different user who subsequently connects.
  useEffect(() => {
    if (address === null) {
      setStream(null);
      setHistoryEntries([]);
      setError(null);
      setAllStreams([]);
    }
  }, [address]);

  // ── Load stream on mount ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadStream() {
      setPageLoading(true);
      setError(null);
      setIsNetworkError(false);

      // Validate ID format client-side before making any network call.
      // This prevents an infinite loading spinner for clearly invalid IDs
      // (e.g. path traversal characters, excessively long strings).
      if (!isValidStreamId(params.id)) {
        setError(`"${params.id}" is not a valid stream ID.`);
        setIsNetworkError(false);
        setPageLoading(false);
        return;
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Network timeout: stream data could not be loaded within 10 seconds.")), STREAM_FETCH_TIMEOUT_MS),
        );
        const data = await Promise.race([
          sorostream.getStream(params.id),
          timeoutPromise,
        ]);
        if (cancelled) return;
        if (!data) {
          setError("Stream not found.");
          return;
        }
        setStream(data);
        // Populate history with mock data only as a fallback while the
        // contract doesn't emit indexable events. The isMock flag lets
        // downstream components suppress display and export.
        setHistoryEntries(
          getMockStreamHistory(params.id).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          ),
        );
      } catch (err) {
        console.error("Failed to load stream", err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load stream data.";
          setError(message);
          setIsNetworkError(true);
          const nextError = err instanceof Error ? err : new Error("Failed to load stream data.");
          setRouteError(nextError);
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    void loadStream();

    return () => {
      cancelled = true;
    };
  }, [params.id, fetchKey]);

  // ── Milestone notifications (#421, #358) ──────────────────────────────────
  // Fire an in-app toast and opt-in push notification the first time a stream crosses 25/50/75% progress.
  useEffect(() => {
    firedMilestonesRef.current = new Set();

    const milestones = [25, 50, 75];
    const computeProgress = (s: StreamData): number => {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      const total = end - start;
      if (total <= 0) return s.status === "Ended" || s.status === "Cancelled" ? 100 : 0;
      return Math.max(0, Math.min(100, ((Date.now() - start) / total) * 100));
    };

    const check = () => {
      const s = streamRef.current;
      if (!s) return;
      if (s.status === "Paused" || s.status === "Cancelled") return;

      const pct = computeProgress(s);
      for (const m of milestones) {
        if (pct >= m && !firedMilestonesRef.current.has(m)) {
          firedMilestonesRef.current.add(m);
          addToast(`🎉 Milestone reached: Stream #${s.id} is ${m}% completed!`, "success");

          if (
            pushNotificationsEnabled &&
            typeof window !== "undefined" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            try {
              new Notification("Milestone Reached! 🎉", {
                body: `Stream #${s.id} has crossed ${m}% completion.`,
              });
            } catch {
              // ignore push errors
            }
          }
        }
      }
    };

    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [stream?.id, addToast, pushNotificationsEnabled]);

  // ── Load all streams for comparison modal ──────────────────────────────────
  useEffect(() => {
    if (!address) {
      setAllStreams([]);
      return;
    }

    async function loadAllStreams() {
      try {
        const streams = await getStreamsForWallet(address);
        setAllStreams(streams);
      } catch (err) {
        console.error("Failed to load streams for comparison", err);
        // Silently fail — comparison feature is optional
      }
    }

    void loadAllStreams();
  }, [address]);

  const handleRetry = useCallback(() => {
    setRouteError(null);
    setFetchKey((k) => k + 1);
  }, []);

  if (routeError) {
    throw routeError;
  }

  // ── Withdraw with optimistic update ───────────────────────────────────────
  const executeWithdraw = useCallback(async () => {
    const prevStream = getMockStream(params.id);
    const prevClaimable = prevStream ? Number(claimableNow(prevStream)) : 0;

    setOptimisticClaimable(0);
    setWithdrawLoading(true);

    try {
      const result = await sorostream.withdraw();
      setOptimisticClaimable(null);
      refetchBalance();
      addToast(`Withdrawal submitted! Tx: ${result.txHash}`, "success");
    } catch {
      setOptimisticClaimable(null);
      void prevClaimable;
      addToast("Withdrawal failed. Please try again.", "error");
    } finally {
      setWithdrawLoading(false);
    }
  }, [params.id, addToast, refetchBalance]);

  const handleWithdraw = useCallback(() => {
    const prevStream = getMockStream(params.id);
    const claimableStroops = prevStream ? Number(claimableNow(prevStream)) : 0;
    const claimableXlm = claimableStroops / 10_000_000;

    if (claimableXlm >= withdrawThreshold) {
      setWithdrawConfirmAmount(formatStellarAmount(claimableStroops));
    } else {
      void executeWithdraw();
    }
  }, [params.id, withdrawThreshold, executeWithdraw]);

  // ── Top-up with optimistic update ─────────────────────────────────────────
  const handleTopUp = useCallback(async () => {
    const parsedAmount = parseFloat(topUpAmount);
    if (!topUpAmount || parsedAmount <= 0) return;
    if (!stream) return;

    const prevDeposit = stream.deposit;
    const addedStroops = Number(toStroops(topUpAmount));
    setOptimisticDeposit(prevDeposit + addedStroops);
    setTopUpLoading(true);

    try {
      await sorostream.topUp();
      const updated = await sorostream.getStream(params.id);
      setStream(updated);
      setOptimisticDeposit(null);
      setShowTopUp(false);
      setTopUpAmount("");
      addToast("Top-up successful!", "success");
    } catch {
      setOptimisticDeposit(null);
      void prevDeposit;
      addToast("Top-up failed. Please try again.", "error");
    } finally {
      setTopUpLoading(false);
    }
  }, [topUpAmount, stream, params.id, addToast]);

  // ── Cancel: submit the actual transaction ──────────────────────────────────
  const submitCancel = useCallback(async () => {
    setCancelPending(false);
    setCancelLoading(true);

    if (cancelToastIdRef.current !== null) {
      removeToast(cancelToastIdRef.current);
      cancelToastIdRef.current = null;
    }

    try {
      const result = await sorostream.cancelStream(params.id);
      // Refresh stream data so status transitions to Cancelled
      const updated = await sorostream.getStream(params.id);
      if (updated) setStream(updated);
      // Notify dashboard and other consumers to re-fetch stream data
      triggerStreamRefresh();
      addToast(`Stream cancelled. Tx: ${result.txHash}`, "success");
    } catch {
      addToast("Cancellation failed. Please try again.", "error");
    } finally {
      setCancelLoading(false);
    }
  }, [addToast, removeToast, triggerStreamRefresh, params.id]);

  // ── Cancel: undo during grace period ──────────────────────────────────────
  const handleCancelUndo = useCallback(() => {
    undoRef.current = true;

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }
    if (cancelToastIdRef.current !== null) {
      removeToast(cancelToastIdRef.current);
      cancelToastIdRef.current = null;
    }

    setCancelPending(false);
    addToast("Cancellation undone.", "info");
  }, [removeToast, addToast]);

  // ── Cancel: start the 5-second grace period ────────────────────────────────
  const handleCancelConfirmed = useCallback(() => {
    setShowCancelModal(false);
    if (cancelPending || cancelLoading) return;

    undoRef.current = false;
    setCancelPending(true);

    let secondsLeft = CANCEL_GRACE_SECONDS;
    const toastKey = `cancel-grace-${params.id}`;

    const showCountdown = (secs: number) => {
      const toastId = upsertPersistentToast(
        toastKey,
        `Cancelling stream #${params.id} in ${secs}s…`,
        "warning",
        { label: "Undo", onClick: handleCancelUndo },
      );
      cancelToastIdRef.current = toastId;
    };

    showCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        showCountdown(secondsLeft);
      } else {
        clearInterval(countdownIntervalRef.current!);
        countdownIntervalRef.current = null;
      }
    }, 1000);

    submitTimeoutRef.current = setTimeout(() => {
      if (!undoRef.current) {
        void submitCancel();
      }
    }, CANCEL_GRACE_SECONDS * 1000);
  }, [cancelPending, cancelLoading, params.id, upsertPersistentToast, handleCancelUndo, submitCancel]);

  const isBusy = withdrawLoading || cancelLoading || cancelPending || topUpLoading || pauseLoading || resumeLoading || transferLoading;

  /** Status used for rendering — reflects an in-flight pause/resume immediately. */
  const displayStatus = optimisticStatus ?? (stream?.status ?? "");

  // Clear the optimistic status once the real stream data catches up.
  useEffect(() => {
    if (optimisticStatus && stream?.status === optimisticStatus) {
      setOptimisticStatus(null);
    }
  }, [stream?.status, optimisticStatus]);

  // ── Pause stream ──────────────────────────────────────────────────────
  const handlePauseConfirmed = useCallback(async () => {
    setShowPauseModal(false);
    setPauseLoading(true);
    // Reflect the new state immediately so the button can't be re-triggered
    // and the UI never shows the stale (incorrect) status while pending.
    setOptimisticStatus("Paused");
    try {
      const result = await sorostream.pauseStream(params.id);
      const updated = await sorostream.getStream(params.id);
      if (updated) setStream(updated);
      addToast(`Stream paused. Tx: ${result.txHash}`, "success");
    } catch {
      setOptimisticStatus(null);
      addToast("Failed to pause stream. Please try again.", "error");
    } finally {
      setPauseLoading(false);
    }
  }, [params.id, addToast]);

  // ── Resume stream ────────────────────────────────────────────────────
  const handleResumeConfirmed = useCallback(async () => {
    setShowResumeModal(false);
    setResumeLoading(true);
    // Reflect the new state immediately so the button can't be re-triggered
    // and the UI never shows the stale (incorrect) status while pending.
    setOptimisticStatus("Active");
    try {
      const result = await sorostream.resumeStream(params.id);
      const updated = await sorostream.getStream(params.id);
      if (updated) setStream(updated);
      addToast(`Stream resumed. Tx: ${result.txHash}`, "success");
    } catch {
      setOptimisticStatus(null);
      addToast("Failed to resume stream. Please try again.", "error");
    } finally {
      setResumeLoading(false);
    }
  }, [params.id, addToast]);

  // ── Schedule pause at a future time ──────────────────────────────────────
  const handleSchedulePauseConfirmed = useCallback(async () => {
    const ms = new Date(pauseAtInput).getTime();
    if (!pauseAtInput || !Number.isFinite(ms) || ms <= Date.now()) {
      addToast("Please choose a future date and time.", "error");
      return;
    }
    setSchedulePauseLoading(true);
    try {
      const result = await sorostream.schedulePause(params.id, Math.floor(ms / 1000));
      const updated = await sorostream.getStream(params.id);
      if (updated) setStream(updated);
      setShowSchedulePauseModal(false);
      setPauseAtInput("");
      addToast(`Pause scheduled. Tx: ${result.txHash}`, "success");
    } catch {
      addToast("Failed to schedule pause. Please try again.", "error");
    } finally {
      setSchedulePauseLoading(false);
    }
  }, [params.id, pauseAtInput, addToast]);

  // ── Transfer recipient ───────────────────────────────────────────────
  const handleTransferConfirmed = useCallback(async () => {
    const trimmed = transferRecipientAddress.trim();
    if (!trimmed || !/^G[A-Z2-7]{55}$/.test(trimmed)) {
      setTransferError("Please enter a valid Stellar public key (starts with G, 56 chars).");
      return;
    }
    setTransferError("");
    setTransferLoading(true);
    try {
      const result = await sorostream.transferRecipient(params.id, trimmed);
      const updated = await sorostream.getStream(params.id);
      if (updated) setStream(updated);
      setShowTransferModal(false);
      setTransferRecipientAddress("");
      addToast(`Recipient transferred. Tx: ${result.txHash}`, "success");
    } catch {
      addToast("Failed to transfer recipient. Please try again.", "error");
    } finally {
      setTransferLoading(false);
    }
  }, [params.id, transferRecipientAddress, addToast]);

  // ── Stream completion ─────────────────────────────────────────────────────
  /** True when the current wall-clock time has passed the stream's end time. */
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    if (!stream || stream.status === "Cancelled") {
      setIsCompleted(false);
      return;
    }

    const endMs = new Date(stream.endTime).getTime();
    const now = Date.now();
    const completedNow = stream.status === "Ended" || now >= endMs;
    setIsCompleted(completedNow);

    if (completedNow) return;

    const timeout = window.setTimeout(() => {
      setIsCompleted(true);
    }, Math.max(0, endMs - now));

    return () => window.clearTimeout(timeout);
  }, [stream]);

  const handleClaimFinal = useCallback(async () => {
    setClaimFinalLoading(true);
    try {
      const result = await sorostream.withdraw();
      addToast(`Final amount claimed! Tx: ${result.txHash}`, "success");
      setClaimFinalDone(true);
    } catch {
      addToast("Claim failed. Please try again.", "error");
    } finally {
      setClaimFinalLoading(false);
    }
  }, [addToast]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const shortcutGroups: ShortcutGroup[] = useMemo(() => [
    {
      title: "Stream Detail",
      shortcuts: [
        { key: "w", description: "Withdraw", action: () => { if (!isBusy) handleWithdraw(); } },
        { key: "c", description: "Cancel", action: () => { if (!cancelLoading && !withdrawLoading && !topUpLoading) setShowCancelModal(true); } },
        { key: "p", description: displayStatus === "Paused" ? "Resume" : "Pause", action: () => {
          if (pauseLoading || resumeLoading || cancelLoading || withdrawLoading || topUpLoading) return;
          if (displayStatus === "Paused") setShowResumeModal(true);
          else if (displayStatus === "Active") setShowPauseModal(true);
        }},
        { key: "t", description: "Toggle top-up", action: () => setShowTopUp((v) => !v) },
        { key: "Escape", description: "Close modals", action: () => { setShowCancelModal(false); setShowQrModal(false); setShowTopUp(false); setShowPauseModal(false); setShowResumeModal(false); setShowTransferModal(false); } },
        { key: "?", shift: true, description: "Toggle keyboard shortcuts help", action: () => setShowShortcutsHelp((v) => !v) },
      ],
    },
  ], [handleWithdraw, isBusy, cancelLoading, withdrawLoading, topUpLoading, displayStatus, pauseLoading, resumeLoading]);

  useKeyboardShortcuts(shortcutGroups);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const formatUSDC = (stroops: number) => (stroops / 10_000_000).toFixed(2);
  const displayDeposit = optimisticDeposit != null ? optimisticDeposit : stream?.deposit ?? 0;
  const isDepositOptimistic = optimisticDeposit != null;



  // ── Render: wallet not connected ──────────────────────────────────────────
  if (address === null) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-sm mx-auto mt-20 text-center space-y-6">
          <div className="text-5xl" aria-hidden="true">🔒</div>
          <h1 className="text-xl font-semibold">Connect your wallet</h1>
          <p className="text-gray-400 text-sm">
            Connect your wallet to view stream #{params.id}.
          </p>
          <div className="flex justify-center">
            <WalletConnect />
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white underline transition-colors"
          >
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ── Render: loading ────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <Link
              href="/dashboard"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Dashboard
            </Link>
          </div>
          <h1 className="text-2xl font-bold mb-8">Stream #{params.id}</h1>
          <SkeletonDetail />
        </div>
      </main>
    );
  }

  // ── Render: not found / error ─────────────────────────────────────────────
  if (!stream) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <Link
              href="/dashboard"
              className="text-sm text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded"
            >
              ← Dashboard
            </Link>
          </div>
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            {isNetworkError ? (
              <>
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="40" cy="40" r="36" fill="#1f2937" stroke="#374151" strokeWidth="2" />
                  <path d="M28 40h24M40 28v24" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <h1 className="text-2xl font-bold">Connection Error</h1>
                <p className="text-gray-400 text-sm max-w-sm">
                  {error ?? "Unable to reach the Soroban RPC. Please check your network connection and try again."}
                </p>
                <button
                  onClick={handleRetry}
                  className="mt-2 inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                >
                  Try Again
                </button>
              </>
            ) : (
              <>
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="40" cy="40" r="36" fill="#1f2937" stroke="#374151" strokeWidth="2" />
                  <path d="M28 28 L52 52 M52 28 L28 52" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <h1 className="text-2xl font-bold">Stream Not Found</h1>
                <p className="text-gray-400 text-sm max-w-sm">{error ?? "The stream you're looking for doesn't exist or may have been removed."}</p>
                <Link
                  href="/dashboard"
                  className="mt-2 inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                >
                  ← Back to Dashboard
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  const toXlm = (stroops: number) => (stroops / 10_000_000).toFixed(2);
  const depositXlm = stream.deposit / 10_000_000;
  const flowXlm = stream.flowRate / 10_000_000;

  // Determine if we should display USD equivalents and which type
  const isUsdcToken = stream.token === "USDC";
  const depositAmount = stream.deposit / 10_000_000;
  const flowAmount = stream.flowRate / 10_000_000;

  // ── Render: detail ─────────────────────────────────────────────────────────
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      {successPhase !== null && (
        <div
          aria-live="polite"
          aria-atomic="true"
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-700 text-white px-6 py-3 rounded-full shadow-lg text-sm font-medium pointer-events-none ${
            successPhase === "in"
              ? "animate-stream-success-in"
              : "animate-stream-success-out"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Stream created successfully!
        </div>
      )}
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="mb-4">
          <Link
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded"
          >
            ← Dashboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">Stream #{stream.id}</h1>
        <div className="flex flex-col sm:flex-row sm:gap-4 text-sm text-gray-400 mb-8">
          <span>
            From:{" "}
            <span className="text-white">
              <FederationName address={stream.sender} truncate />
            </span>
          </span>
          <span className="hidden sm:inline" aria-hidden="true">|</span>
          <span>
            To:{" "}
            <span className="text-white">
              <FederationName address={stream.recipient} truncate />
            </span>
          </span>
          <span className="hidden sm:inline" aria-hidden="true">|</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              displayStatus === "Active"
                ? "bg-green-900 text-green-400"
                : displayStatus === "Paused"
                ? "bg-yellow-900 text-yellow-400"
                : displayStatus === "Cancelled"
                ? "bg-red-900 text-red-400"
                : "bg-gray-700 text-gray-400"
            }`}
            aria-label={`Status: ${displayStatus}`}
            data-testid="stream-status"
          >
            {displayStatus}
          </span>
        </div>

        {/* #408 — Plaintext memo attached at creation time */}
        {getStreamMemo(stream) && (
          <p className="mb-4 text-sm text-gray-300 flex items-center gap-2">
            <span className="text-gray-500">Memo:</span>
            <span className="bg-gray-800 border border-gray-700 rounded-full px-3 py-1">
              {getStreamMemo(stream)}
            </span>
          </p>
        )}

        {/* Stream Health Card */}
        <div className="mb-4">
          <StreamHealthCard stream={stream} historyEntries={historyEntries} />
        </div>

        <div className="flex flex-wrap justify-end gap-2 mb-4 print-hidden">
          {/* Bookmark toggle */}
          <button
            onClick={() => toggleBookmark(stream.id)}
            aria-label={isBookmarked(stream.id) ? "Remove bookmark" : "Bookmark this stream"}
            aria-pressed={isBookmarked(stream.id)}
            className={`inline-flex items-center gap-2 py-2 px-4 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
              isBookmarked(stream.id)
                ? "border-yellow-500 text-yellow-400 bg-yellow-900/20"
                : "border-gray-600 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span aria-hidden="true">{isBookmarked(stream.id) ? "★" : "☆"}</span>
            {isBookmarked(stream.id) ? "Bookmarked" : "Bookmark"}
          </button>

          {/* Print / PDF export */}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Export PDF
          </button>

          {/* Get Receipt — only for Completed or Cancelled streams */}
           {(displayStatus === "Ended" || displayStatus === "Cancelled" || isCompleted) && (
            <Link
              href={`/stream/${stream.id}/receipt`}
              className="inline-flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Get Receipt
            </Link>
          )}

          <button
            onClick={() => setShowCloneModal(true)}
            aria-label="Clone this stream"
            className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Clone
          </button>
          
          <button
            onClick={() => setShowSaveTemplateModal(true)}
            aria-label="Save as template"
            className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save as Template
          </button>
          
          <div className="relative inline-block" ref={shareMenuRef}>
            <button
              onClick={() => setShowShareMenu((v) => !v)}
              aria-expanded={showShareMenu}
              aria-haspopup="true"
              aria-label="Share options for this stream"
              className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.51" />
              </svg>
              Share
            </button>
            {showShareMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-lg shadow-xl z-50 py-1 origin-top-right">
                <a
                  href={generateTwitterShareUrl(stream.id, window.location.origin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Twitter / X
                </a>
                <a
                  href={generateLinkedInShareUrl(stream.id, window.location.origin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                  LinkedIn
                </a>
                <button
                  onClick={() => {
                    copyText(generateCopyLinkUrl(stream.id, window.location.origin));
                    addToast("Deep link copied to clipboard!", "success");
                    setShowShareMenu(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Copy Link
                </button>
                {/* #418 — read-only shareable link, no wallet required */}
                <button
                  onClick={() => {
                    copyText(generateReadOnlyShareUrl(stream.id, window.location.origin));
                    addToast("Read-only link copied to clipboard!", "success");
                    setShowShareMenu(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  </svg>
                  Copy Read-only Link
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Social sharing buttons — visible without scrolling, below action bar */}
        <div className="mt-4 mb-2">
          <StreamShareButtons
            streamId={stream.id}
            shareText={`Check out Stream #${stream.id} on SoroStream — real-time payment streaming on Stellar Soroban.`}
          />
        </div>

        {/* Stream completed banner — shown when currentTime >= endTime */}
        {isCompleted && (              <StreamCompletedBanner
            streamId={stream.id}
            finalAmount={formatUSDC(stream.deposit)}
            token={stream.token}
            onClaim={handleClaimFinal}
            claiming={claimFinalLoading}
            claimed={claimFinalDone}
          />
        )}

          <StreamTimeline
            startTime={stream.startTime}
            endTime={stream.endTime}
            sender={stream.sender}
            recipient={stream.recipient}
            status={displayStatus}
            flowRate={stream.flowRate}
          />

          {/* Scheduled start countdown — shown only when stream hasn't started yet */}
          {stream.scheduledStartTime &&
            stream.scheduledStartTime > Math.floor(Date.now() / 1000) && (
              <StartCountdownTimer scheduledStartTime={stream.scheduledStartTime} />
            )}

          <CountdownTimer endTime={stream.endTime} />

          <StreamProgressBar stream={stream} />

          {/* Milestone Push Notification Opt-in toggle (#358) */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-700/60 text-xs text-gray-400">
            <span>Milestone Push Notifications (25%, 50%, 75%)</span>
            <button
              type="button"
              onClick={handleTogglePushNotifications}
              data-testid="milestone-push-toggle"
              aria-pressed={pushNotificationsEnabled}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                pushNotificationsEnabled
                  ? "bg-green-900/60 border-green-600 text-green-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              {pushNotificationsEnabled ? "🔔 Push Enabled" : "🔕 Enable Push"}
            </button>
          </div>

          {/* Collateral unlock badge — shown when sender has collateral */}
          {displayStatus !== "Cancelled" && (
            <CollateralUnlockBadge
              endTime={stream.endTime}
              gracePeriodSeconds={86400}
              isSender={address !== null && address.includes(stream.sender.slice(0, 5))}
              hasCollateral={stream.sender.includes("GBAM") || stream.sender.includes("GDEF")}
              onClaim={async () => {
                try {
                  await sorostream.withdraw();
                  addToast("Collateral claimed successfully!", "success");
                } catch {
                  addToast("Claim failed. Please try again.", "error");
                }
              }}
            />
          )}

          {/* Deposit & flow rate */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400 mb-1">Total deposit</p>
              <p className="text-white font-mono">
                {toXlm(stream.deposit)} {stream.token}
                <FiatDisplay
                  {...(isUsdcToken ? { usdcAmount: depositAmount } : { xlmAmount: depositXlm })}
                />
              </p>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Flow rate</p>
              <p className="text-green-400 font-mono">
                {toXlm(stream.flowRate)} {stream.token}/sec
                <FiatDisplay
                  {...(isUsdcToken ? { usdcAmount: flowAmount } : { xlmAmount: flowXlm })}
                />
              </p>
            </div>
            {stream.autoRenew && (
              <div className="col-span-2">
                <p className="text-gray-400 mb-1">Auto-renewal</p>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-900/40 border border-green-700/50 text-green-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M8 16H3v5" />
                    </svg>
                    Auto-renewal enabled
                  </span>
                  {stream.autoRenewDurationSeconds && (
                    <span className="text-xs text-gray-400">
                      {(() => {
                        const s = stream.autoRenewDurationSeconds;
                        if (s >= 86400) return `every ${Math.floor(s / 86400)}d`;
                        if (s >= 3600) return `every ${Math.floor(s / 3600)}h`;
                        return `every ${Math.floor(s / 60)}m`;
                      })()}
                    </span>
                  )}
                </div>
              </div>
            )}
            {stream.metadataUri && (
              <div className="col-span-2">
                <p className="text-gray-400 mb-1 flex items-center gap-2">
                  Metadata URI
                  <div className="relative group">
                    <button
                      type="button"
                      aria-label="What is metadata URI?"
                      className="text-gray-500 hover:text-gray-300 text-xs border border-gray-600 rounded-full w-4 h-4 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    >
                      ?
                    </button>
                    <div
                      role="tooltip"
                      className="hidden group-hover:block group-focus-within:block absolute left-0 bottom-6 w-64 bg-gray-700 border border-gray-600 rounded-lg p-3 text-xs text-gray-300 leading-relaxed z-10 shadow-lg"
                    >
                      External metadata reference that provides additional context or documentation
                      about this stream. Can point to JSON, terms of service, or other relevant data.
                    </div>
                  </div>
                </p>
                <a
                  href={stream.metadataUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-900/40 border border-blue-700/50 text-blue-300 hover:bg-blue-900/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={stream.metadataUri}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  {stream.metadataUri.length > 40 ? `${stream.metadataUri.slice(0, 37)}…` : stream.metadataUri}
                </a>
              </div>
            )}
          </div>

          {/* Claimable balance — optimistic withdraw support */}
          <StreamErrorBoundary section="Live Counter" resetKey={stream.id}>
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-2">Claimable now</p>
              <div className="text-2xl sm:text-3xl font-bold">
                <LiveCounter
                  streamId={stream.id}
                  flowRate={stream.flowRate}
                  lastWithdrawTime={new Date(stream.lastWithdrawTime)}
                  status={stream.status}
                  pausedAt={stream.pausedAt}
                  optimisticOverride={optimisticClaimable}
                />
              </div>
            </div>
          </StreamErrorBoundary>

          {/* Stream balance — optimistic top-up support */}
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">Stream balance (deposit)</p>
            <p
              className={`font-mono font-semibold text-lg ${
                isDepositOptimistic ? "text-yellow-400" : "text-white"
              }`}
            >
              {formatUSDC(displayDeposit)} {stream.token}
              {isDepositOptimistic && (
                <span className="ml-2 text-xs font-normal text-yellow-400/80 italic">
                  (pending…)
                </span>
              )}
            </p>
          </div>

          {/* Vesting analytics chart */}
          <VestingChart stream={stream} history={historyEntries} />

          {error && (
            <p role="alert" className="text-red-400 text-sm text-center">
              {error}
            </p>
          )}

          {/* Withdraw / Cancel */}
          <div className="flex gap-4 print-hidden">
            <button
              onClick={handleWithdraw}
              disabled={isBusy}
              className="flex-1 bg-green-700 text-white py-3 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              {withdrawLoading ? (
                <>
                  <Spinner />
                  Withdrawing…
                </>
              ) : (
                "Withdraw"
              )}
            </button>

            <button
              onClick={cancelPending ? handleCancelUndo : () => setShowCancelModal(true)}
              disabled={cancelLoading || withdrawLoading || topUpLoading || pauseLoading || resumeLoading}
              aria-live="polite"
              className={`flex-1 py-3 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${
                cancelPending
                  ? "bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500"
                  : "border border-red-600 text-red-400 hover:bg-red-900 focus-visible:ring-red-500"
              }`}
            >
              {cancelLoading ? (
                <>
                  <Spinner />
                  Cancelling…
                </>
              ) : cancelPending ? (
                "Undo Cancel"
              ) : (
                "Cancel"
              )}
            </button>
          </div>

          {/* Pause / Resume (visible to sender only, based on status) */}
          {address && stream.sender.includes(address.slice(0, 5)) && displayStatus === "Active" && (
            <button
              onClick={() => setShowPauseModal(true)}
              disabled={isBusy}
              className="w-full border border-yellow-600 text-yellow-400 py-3 rounded-lg font-medium hover:bg-yellow-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {pauseLoading ? (
                <>
                  <Spinner />
                  Pausing…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Pause Stream
                </>
              )}
            </button>
          )}

          {address && stream.sender.includes(address.slice(0, 5)) && stream.status === "Active" && (
            <button
              onClick={() => setShowSchedulePauseModal(true)}
              disabled={isBusy}
              className="w-full border border-indigo-600 text-indigo-400 py-3 rounded-lg font-medium hover:bg-indigo-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              {t("schedule_pause")}
            </button>
          )}

          {stream.pauseAt && stream.pauseAt > Math.floor(Date.now() / 1000) && (
            <p className="text-xs text-indigo-400/80 text-center">
              {t("scheduled_pause_badge")}: {new Date(stream.pauseAt * 1000).toLocaleString()}
            </p>
          )}

	          {address && stream.sender.includes(address.slice(0, 5)) && displayStatus === "Paused" && (
	            <button
              onClick={() => setShowResumeModal(true)}
              disabled={isBusy}
              className="w-full border border-green-600 text-green-400 py-3 rounded-lg font-medium hover:bg-green-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {resumeLoading ? (
                <>
                  <Spinner />
                  Resuming…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Resume Stream
                </>
              )}
            </button>
          )}

          {/* Transfer Recipient (visible to sender only) */}
          {address && stream.sender.includes(address.slice(0, 5)) && (
            <button
              onClick={() => { setShowTransferModal(true); setTransferRecipientAddress(""); setTransferError(""); }}
              disabled={isBusy}
              className="w-full border border-blue-600 text-blue-400 py-2 rounded-lg text-sm hover:bg-blue-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              Transfer Recipient
            </button>
          )}

          <button
            onClick={() => setShowQrModal(true)}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            QR Code
          </button>

          {/* Embed widget */}
          <button
            onClick={() => setShowEmbedModal(true)}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Embed Widget
          </button>

          {/* Compare streams */}
          <button
            onClick={() => setShowComparisonModal(true)}
            disabled={allStreams.length <= 1}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            title={allStreams.length <= 1 ? t("compare_button_tooltip") : ""}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="20" cy="5" r="1" />
              <circle cx="20" cy="19" r="1" />
              <path d="M9 6v6" />
              <path d="M20 6v6" />
              <path d="M9 18v-6" />
              <path d="M20 18v-6" />
            </svg>
            {t("compare")}
          </button>

          {/* Top-up form */}
          {showTopUp && (
            <div className="space-y-2">
              <label htmlFor="topup-amount" className="text-gray-200 text-sm font-medium block">
                Top-up Amount ({stream.token})
              </label>
              <input
                id="topup-amount"
                type="number"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder={`Amount (${stream.token})`}
                min="0"
                step="0.01"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              />
              <button
                onClick={handleTopUp}
                disabled={topUpLoading || !topUpAmount || parseFloat(topUpAmount) <= 0}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {topUpLoading ? (
                  <>
                    <Spinner />
                    Topping up…
                  </>
                ) : (
                  "Confirm Top-up"
                )}
              </button>
            </div>
          )}
          <button
            onClick={() => setShowTopUp((v) => !v)}
            aria-expanded={showTopUp}
            disabled={topUpLoading}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50"
          >
            {showTopUp ? "Cancel Top-up" : "Top Up Stream"}
          </button>

          {/* Tags */}
          <StreamTagEditor streamId={stream.id} />

          {/* Transaction history */}
          <StreamErrorBoundary section="Transaction History" resetKey={stream.id}>
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" className="text-lg font-semibold mb-3">
                Transaction History
              </h2>
              {(() => {
                // Only show entries sourced from real on-chain data. Mock
                // entries (isMock: true) are synthesised client-side and
                // must never be displayed as authoritative history.
                const realEntries = historyEntries.filter((e) => !e.isMock);
                const hasOnlyMockData = historyEntries.length > 0 && realEntries.length === 0;

                if (hasOnlyMockData) {
                  return (
                    <div className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700 space-y-2">
                      <p className="text-gray-300 font-medium text-sm">No transaction history yet</p>
                      <p className="text-gray-500 text-xs leading-relaxed">
                        On-chain events are not yet indexed for this stream. Transaction
                        history will appear here once contract event indexing is available.
                      </p>
                    </div>
                  );
                }

                return (
                  <>
                    <StreamHistory entries={realEntries} streamId={params.id} />
                    {realEntries.length > 0 && (
                      <div className="mt-4">
                        <p className="text-gray-400 text-sm font-medium mb-3">
                          History Export
                        </p>
                        <TransactionExportButton
                          entries={realEntries}
                          account={stream.recipient}
                          onExported={(filename) => addToast(`Exported ${filename}`, "success")}
                        />
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          </StreamErrorBoundary>

          {/* Analytics section (#358) */}
          <StreamErrorBoundary section="Stream Analytics" resetKey={stream.id}>
            <section aria-labelledby="analytics-heading">
              <h2 id="analytics-heading" className="text-lg font-semibold mb-3">
                Analytics
              </h2>
              <StreamAnalyticsCharts
                stream={stream}
                historyEntries={historyEntries}
              />
            </section>
          </StreamErrorBoundary>
        </div>

      <StreamQrModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        recipient={stream.recipient}
      />

      <KeyboardShortcutsHelp
        open={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        groups={shortcutGroups}
      />

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div
          ref={cancelModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-modal-title"
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 id="cancel-modal-title" className="text-lg font-semibold text-white">
              Cancel Stream?
            </h2>
            <p className="text-gray-400 text-sm">
              This is irreversible. Any unstreamed funds will be returned to the
              sender. You&apos;ll have 5 seconds to undo after confirming.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                Go Back
              </button>
              <button
                onClick={handleCancelConfirmed}
                disabled={cancelLoading}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {cancelLoading ? "Cancelling…" : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause confirmation modal */}
      {showPauseModal && (
        <div
          ref={pauseModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-modal-title"
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 id="pause-modal-title" className="text-lg font-semibold text-white">
              Pause Stream?
            </h2>
            <p className="text-gray-400 text-sm">
              This will temporarily halt the stream. The recipient will not
              receive any funds while the stream is paused. You can resume
              the stream at any time.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowPauseModal(false)}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                Go Back
              </button>
              <button
                onClick={handlePauseConfirmed}
                disabled={pauseLoading}
                className="flex-1 bg-yellow-600 text-white py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {pauseLoading ? "Pausing…" : "Yes, Pause"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume confirmation modal */}
      {showResumeModal && (
        <div
          ref={resumeModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-modal-title"
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 id="resume-modal-title" className="text-lg font-semibold text-white">
              Resume Stream?
            </h2>
            <p className="text-gray-400 text-sm">
              This will resume the paused stream. Funds will start flowing
              to the recipient again from this point forward.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowResumeModal(false)}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                Go Back
              </button>
              <button
                onClick={handleResumeConfirmed}
                disabled={resumeLoading}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {resumeLoading ? "Resuming…" : "Yes, Resume"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule pause modal */}
      {showSchedulePauseModal && (
        <div
          ref={schedulePauseModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-pause-modal-title"
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 id="schedule-pause-modal-title" className="text-lg font-semibold text-white">
              {t("schedule_pause_title")}
            </h2>
            <p className="text-gray-400 text-sm">{t("schedule_pause_desc")}</p>
            <div>
              <label htmlFor="pause-at" className="text-gray-200 text-sm font-medium block mb-1">
                {t("pause_at_label")}
              </label>
              <input
                id="pause-at"
                type="datetime-local"
                value={pauseAtInput}
                onChange={(e) => setPauseAtInput(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowSchedulePauseModal(false); setPauseAtInput(""); }}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedulePauseConfirmed}
                disabled={schedulePauseLoading || !pauseAtInput}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {schedulePauseLoading ? "Scheduling…" : t("schedule_pause_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer recipient modal */}
      {showTransferModal && (
        <div
          ref={transferModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-modal-title"
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        >
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 id="transfer-modal-title" className="text-lg font-semibold text-white">
              Transfer Recipient
            </h2>
            <p className="text-gray-400 text-sm">
              Reassign this stream to a new recipient address. The current
              recipient will stop receiving funds, and the new recipient
              will begin receiving from this point forward.
            </p>
            <div>
              <label htmlFor="transfer-recipient" className="text-gray-200 text-sm font-medium block mb-1">
                New Recipient Address
              </label>
              <input
                id="transfer-recipient"
                type="text"
                value={transferRecipientAddress}
                onChange={(e) => {
                  setTransferRecipientAddress(e.target.value);
                  setTransferError("");
                }}
                placeholder="GABCDEF…"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                aria-invalid={!!transferError}
                aria-describedby={transferError ? "transfer-error" : undefined}
              />
              {transferError && (
                <p id="transfer-error" className="text-red-400 text-xs mt-1">
                  {transferError}
                </p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferRecipientAddress("");
                  setTransferError("");
                }}
                className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleTransferConfirmed}
                disabled={transferLoading || !transferRecipientAddress.trim()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {transferLoading ? (
                  <>
                    <Spinner />
                    Transferring…
                  </>
                ) : (
                  "Submit"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {withdrawConfirmAmount !== null && (
        <WithdrawConfirmModal
          amount={withdrawConfirmAmount}
          onConfirm={() => { setWithdrawConfirmAmount(null); void executeWithdraw(); }}
          onCancel={() => setWithdrawConfirmAmount(null)}
        />
      )}

      {showEmbedModal && (
        <EmbedWidgetModal
          streamId={stream.id}
          onClose={() => setShowEmbedModal(false)}
        />
      )}

      {stream && (
        <StreamComparisonModal
          open={showComparisonModal}
          onClose={() => setShowComparisonModal(false)}
          currentStream={stream}
          availableStreams={allStreams}
        />
      )}

      {stream && showCloneModal && (
        <StreamCloneModal
          stream={stream}
          onClose={() => setShowCloneModal(false)}
        />
      )}

      {stream && (
        <SaveTemplateModal
          open={showSaveTemplateModal}
          onClose={() => setShowSaveTemplateModal(false)}
          durationSeconds={stream.endTime - stream.startTime}
          amount={formatStellarAmount(stream.deposit)}
          recipient={stream.recipient}
          token={stream.token}
        />
      )}
    </main>
  );
}

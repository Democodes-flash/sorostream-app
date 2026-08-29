"use client";

import { useEffect, useState } from "react";
import {
  MIN_ENGAGEMENT_MS,
  onInstallPromptChange,
  triggerInstallPrompt,
} from "@/src/lib/pwa";

const DISMISSED_KEY = "sorostream-pwa-dismissed";
const VISIT_COUNT_KEY = "sorostream_visit_count";
const SESSION_COUNTED_KEY = "sorostream_session_counted";

export default function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [engagementMet, setEngagementMet] = useState(false);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Detect standalone mode — don't show the prompt if already installed.
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true);

  // Track visit count (increments once per session)
  useEffect(() => {
    if (typeof window === "undefined" || isStandalone) return;

    if (!sessionStorage.getItem(SESSION_COUNTED_KEY)) {
      sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
      const current = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || "0", 10);
      const updated = current + 1;
      localStorage.setItem(VISIT_COUNT_KEY, String(updated));
    }
  }, [isStandalone]);

  // Listen for beforeinstallprompt availability.
  useEffect(() => {
    if (isStandalone) return;
    const off = onInstallPromptChange((e) => setCanInstall(e !== null));
    return off;
  }, [isStandalone]);

  // Start the engagement timer (fallback for long 1st visit)
  useEffect(() => {
    if (isStandalone) return;
    const timer = setTimeout(() => setEngagementMet(true), MIN_ENGAGEMENT_MS);
    return () => clearTimeout(timer);
  }, [isStandalone]);

  // Show the banner if second visit on mobile browsers OR canInstall + engagement met
  useEffect(() => {
    if (typeof window === "undefined" || isStandalone) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const visits = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || "0", 10);
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    if (visits >= 2 || (canInstall && engagementMet) || (isMobile && visits >= 2)) {
      setVisible(true);
    }
  }, [canInstall, engagementMet, isStandalone]);

  function handleDismiss() {
    setVisible(false);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  }

  async function handleInstall() {
    setInstalling(true);
    const outcome = await triggerInstallPrompt();
    setInstalling(false);
    if (outcome === "accepted" || outcome === "unavailable") {
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install SoroStream app"
      aria-modal="false"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm animate-slide-up"
      data-testid="pwa-install-prompt"
    >
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl px-5 py-4 flex items-start gap-4">
        {/* Brand icon */}
        <div className="shrink-0 mt-0.5">
          <div className="w-10 h-10 rounded-xl bg-gray-900 border border-green-800 flex items-center justify-center">
            <span className="text-green-400 font-bold text-lg leading-none">S</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white mb-0.5">
            Install SoroStream
          </p>
          <p className="text-xs text-gray-400 leading-snug">
            Add to your home screen for quick access — works offline too.
          </p>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="bg-green-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {installing ? "Installing…" : "Install"}
            </button>
            <button
              onClick={handleDismiss}
              className="text-gray-400 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>

        {/* Close ×  */}
        <button
          onClick={handleDismiss}
          className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none mt-0.5"
          aria-label="Dismiss install prompt"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

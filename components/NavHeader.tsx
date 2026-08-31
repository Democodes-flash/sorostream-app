"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NetworkSelector from "@/components/NetworkSelector";
import WalletConnect from "@/components/WalletConnect";
import ThemeToggle from "@/components/ThemeToggle";
import ChangelogModal, { useChangelogUnread } from "@/components/ChangelogModal";
import NotificationBadge from "@/components/NotificationBadge";
import GlobalSearch from "@/components/GlobalSearch";
import WalletBalanceDisplay from "@/components/WalletBalanceDisplay";
import { useNotifications } from "@/src/context/NotificationContext";
import { useSettings } from "@/src/context/SettingsContext";
import { useWallet } from "@/src/context/WalletContext";
import { useTranslations } from "@/src/lib/i18n";
import { useGlobalShortcuts } from "@/components/GlobalShortcuts";
import RpcHealthIndicator from "@/components/RpcHealthIndicator";
import { useNetwork } from "@/src/lib/network";

const NAV_LINKS = [
  { href: "/", key: "home" },
  { href: "/dashboard", key: "dashboard" },
  { href: "/analytics", key: "analytics" },
  { href: "/stream/new", key: "create" },
  { href: "/activity", key: "activity" },
  { href: "/admin", key: "admin" },
  { href: "/archive", key: "archive" },
  { href: "/settings", key: "settings" },
] as const;

export default function NavHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const { countFor, clearSection } = useNotifications();
  const { showUsd, toggleShowUsd } = useSettings();
  const { address, balanceRefreshTrigger } = useWallet();
  const { network } = useNetwork();
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceUpdated, setBalanceUpdated] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const changelogUnread = useChangelogUnread();
  const { openHelp } = useGlobalShortcuts();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Clear a section's unread badge once the user navigates into it (#193).
  useEffect(() => {
    const active = NAV_LINKS.find(
      (l) => pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href)),
    );
    if (active) clearSection(active.href);
  }, [pathname, clearSection]);

  const fetchBalance = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${addr}`);
      if (!res.ok) throw new Error(`Horizon ${res.status}`);
      const data = await res.json() as { balances?: { asset_type: string; asset_code?: string; balance: string }[] };
      const native = data.balances?.find((b) => b.asset_type === "native");
      const usdc = data.balances?.find((b) => b.asset_code === "USDC");
      setXlmBalance(native ? parseFloat(native.balance).toFixed(2) : null);
      setUsdcBalance(usdc ? parseFloat(usdc.balance).toFixed(2) : null);
    } catch {
      setXlmBalance(null);
      setUsdcBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setXlmBalance(null);
      setUsdcBalance(null);
      return;
    }
    void fetchBalance(address);
    const interval = setInterval(() => void fetchBalance(address), 60_000);
    return () => clearInterval(interval);
  // balanceRefreshTrigger: re-fetch immediately when bumped (e.g. after withdrawal)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, fetchBalance, balanceRefreshTrigger]);

  // Brief "Balance updated" indicator when balance changes
  const prevBalanceRef = useRef<string | null>(null);
  const prevUsdcRef = useRef<string | null>(null);
  useEffect(() => {
    const xlmChanged = xlmBalance !== null && prevBalanceRef.current !== null && prevBalanceRef.current !== xlmBalance;
    const usdcChanged = usdcBalance !== null && prevUsdcRef.current !== null && prevUsdcRef.current !== usdcBalance;
    if (xlmChanged || usdcChanged) {
      setBalanceUpdated(true);
      const timer = setTimeout(() => setBalanceUpdated(false), 2000);
      return () => clearTimeout(timer);
    }
    prevBalanceRef.current = xlmBalance;
    prevUsdcRef.current = usdcBalance;
  }, [xlmBalance, usdcBalance]);

  return (
    <>
      <header
        className={`sticky top-0 z-50 border-b transition-colors ${
          scrolled ? "border-gray-200 bg-white/95 dark:border-gray-700 dark:bg-gray-900/95 backdrop-blur" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        }`}
      >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between min-w-0">
        <div className="flex items-center gap-6 min-w-0 shrink">
          <Link href="/" className="text-lg font-bold text-green-400 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900">
            SoroStream
          </Link>
          <nav className="hidden sm:flex items-center gap-4" aria-label={t("main_navigation")}>
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              const unread = countFor(link.href);
              const label = t(link.key);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`text-sm transition-colors rounded-md px-1 py-0.5 inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 dark:focus-visible:ring-offset-gray-900 ${
                    isActive ? "text-gray-900 dark:text-white font-medium" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {label}
                  <NotificationBadge count={unread} label={`${label} update`} />
                  {isActive && <span className="ml-1 inline-block h-1 w-1 rounded-full bg-green-600 dark:bg-green-400" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <GlobalSearch />
          <NetworkSelector />
          <RpcHealthIndicator />
          {address && (
            <span
              className="text-xs text-gray-600 dark:text-gray-300 font-mono hidden sm:inline-block"
              aria-label={t("wallet_balance")}
            >
              {balanceLoading && xlmBalance === null && usdcBalance === null ? (
                <span className="inline-block w-24 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" aria-hidden="true" />
              ) : (xlmBalance !== null || usdcBalance !== null) ? (
                <span className="inline-flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-gray-50 dark:bg-gray-800">
                  {xlmBalance !== null && (
                    <span>{parseFloat(xlmBalance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM</span>
                  )}
                  {usdcBalance !== null && (
                    <span className="text-gray-400 dark:text-gray-500">|</span>
                  )}
                  {usdcBalance !== null && (
                    <span className="text-blue-600 dark:text-blue-400">{parseFloat(usdcBalance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                  )}
                  {balanceUpdated && (
                    <span className="text-[10px] text-green-400 font-normal" aria-live="polite">
                      updated
                    </span>
                  )}
                </span>
              ) : null}
            </span>
          )}
          <WalletConnect compact />
          <button
            onClick={toggleShowUsd}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              showUsd
                ? "border-green-600 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            aria-pressed={showUsd}
            aria-label={showUsd ? t("hide_usd") : t("show_usd")}
            title={showUsd ? t("hide_usd") : t("show_usd")}
          >
            {showUsd ? t("usd_active") : t("usd")}
          </button>
          <button
            onClick={() => setChangelogOpen(true)}
            className="relative text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 dark:focus-visible:ring-offset-gray-900 p-1"
            aria-label={changelogUnread ? t("whats_new_unread") : t("whats_new")}
            title={t("whats_new")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {changelogUnread && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-600 dark:bg-green-400 rounded-full" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={openHelp}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            title={t("keyboard_shortcuts")}
            aria-label={t("open_keyboard_shortcuts")}
          >
            <span className="hidden sm:inline">{t("shortcuts")}</span>
            <span className="sm:hidden">?</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
    {network === "testnet" && (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-700 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-yellow-700 dark:text-yellow-400 flex-shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Testnet mode: Connected to Stellar Testnet. For development and testing only.
          </span>
        </div>
      </div>
    )}
    <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

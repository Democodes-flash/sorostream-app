"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSettings } from "@/src/context/SettingsContext";
import { APP_NETWORK } from "@/src/lib/freighter";
import { useTranslations } from "@/src/lib/i18n";

interface TokenBalance {
  symbol: string;
  balance: string;
  issuer?: string;
}

interface WalletBalanceDisplayProps {
  address: string | null;
  balanceRefreshTrigger?: number;
}

const SUPPORTED_TOKENS = [
  { symbol: "USDC", issuer: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU" },
  { symbol: "XLM", issuer: "native" },
  { symbol: "AQUA", issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
  { symbol: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" },
];

const HORIZON_URL =
  APP_NETWORK === "public" || APP_NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : APP_NETWORK === "futurenet"
    ? "https://horizon-futurenet.stellar.org"
    : "https://horizon-testnet.stellar.org";

export default function WalletBalanceDisplay({
  address,
  balanceRefreshTrigger,
}: WalletBalanceDisplayProps) {
  const t = useTranslations("nav");
  const { language } = useSettings();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceUpdated, setBalanceUpdated] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const prevBalancesRef = useRef<string>("");

  const fetchBalances = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${addr}`);
      if (!res.ok) throw new Error(`Horizon ${res.status}`);
      const data = await res.json() as { balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> };

      const tokenBalances: TokenBalance[] = [];

      for (const token of SUPPORTED_TOKENS) {
        let balance: string | null = null;

        if (token.issuer === "native") {
          const native = data.balances?.find((b) => b.asset_type === "native");
          balance = native ? parseFloat(native.balance).toFixed(2) : "0.00";
        } else {
          const matching = data.balances?.find(
            (b) =>
              b.asset_type === "credit_alphanum12" &&
              b.asset_code === token.symbol &&
              b.asset_issuer === token.issuer
          );
          balance = matching ? parseFloat(matching.balance).toFixed(2) : "0.00";
        }

        if (balance !== null) {
          tokenBalances.push({
            symbol: token.symbol,
            balance,
            issuer: token.issuer,
          });
        }
      }

      const balancesStr = JSON.stringify(tokenBalances);
      if (balancesStr !== prevBalancesRef.current) {
        setBalances(tokenBalances);
        if (prevBalancesRef.current) {
          setBalanceUpdated(true);
          const timer = setTimeout(() => setBalanceUpdated(false), 2000);
          return () => clearTimeout(timer);
        }
        prevBalancesRef.current = balancesStr;
      }
    } catch {
      setBalances([]);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setBalances([]);
      prevBalancesRef.current = "";
      return;
    }

    void fetchBalances(address);
    const interval = setInterval(() => void fetchBalances(address), 60_000);
    return () => clearInterval(interval);
  }, [address, fetchBalances, balanceRefreshTrigger]);

  if (!address) return null;

  const primaryBalance = balances.find((b) => b.symbol === "XLM");
  const otherBalances = balances.filter((b) => b.symbol !== "XLM");

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="text-xs text-gray-600 dark:text-gray-300 font-mono hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        title={t("wallet_balance") || "Wallet balance"}
        aria-label={t("wallet_balance") || "Wallet balance"}
        aria-expanded={showDropdown}
      >
        {balanceLoading && balances.length === 0 ? (
          <span className="inline-block w-16 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" aria-hidden="true" />
        ) : primaryBalance ? (
          <>
            <span>{`${parseFloat(primaryBalance.balance).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`}</span>
            {otherBalances.length > 0 && (
              <span className="text-[10px] bg-green-600 dark:bg-green-500 text-white px-1.5 py-0.5 rounded-full">
                +{otherBalances.length}
              </span>
            )}
            {balanceUpdated && (
              <span className="text-[10px] text-green-400 font-normal" aria-live="polite">
                ✓
              </span>
            )}
          </>
        ) : null}
      </button>

      {showDropdown && otherBalances.length > 0 && (
        <div className="absolute right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50 min-w-48">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t("wallet_balance") || "Wallet Balance"}
          </div>
          <div className="space-y-2">
            {balances.map((token) => (
              <div key={token.symbol} className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400">
                <span className="font-medium">{token.symbol}</span>
                <span className="font-mono">
                  {parseFloat(token.balance).toLocaleString(language, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 7,
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const PULL_THRESHOLD = 60; // 60px required threshold
const MAX_PULL = 100; // max visual pull distance

export default function PullToRefresh({
  onRefresh,
  children,
  className = "",
  disabled = false,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing) return;
      const el = containerRef.current;
      // Only initiate gesture if at the very top of scroll
      const scrollTop = el ? el.scrollTop : window.scrollY;
      if (scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
        isPullingRef.current = false;
      } else {
        startYRef.current = null;
      }
    },
    [disabled, isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (startYRef.current === null || disabled || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      const el = containerRef.current;
      const scrollTop = el ? el.scrollTop : window.scrollY;

      if (diff > 0 && scrollTop <= 0) {
        isPullingRef.current = true;
        // Damping factor for smooth pull feel
        const distance = Math.min(MAX_PULL, diff * 0.5);
        setPullDistance(distance);
        if (e.cancelable) {
          e.preventDefault();
        }
      } else if (diff < 0) {
        isPullingRef.current = false;
        setPullDistance(0);
      }
    },
    [disabled, isRefreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (startYRef.current === null || disabled) return;
    const finalPull = pullDistance;
    startYRef.current = null;
    isPullingRef.current = false;

    if (finalPull >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        await onRefresh();
      } catch (err) {
        console.error("Pull-to-refresh failed:", err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      // Released before threshold — cancel without fetching
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh, disabled]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(1, pullDistance / PULL_THRESHOLD);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto ${className}`}
      data-testid="pull-to-refresh-container"
    >
      {/* Pull / Refresh Indicator Header */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200 text-xs font-medium text-gray-300"
        style={{
          height: `${pullDistance}px`,
          opacity: pullDistance > 0 ? 1 : 0,
        }}
        data-testid="pull-to-refresh-indicator"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 py-2">
          {isRefreshing ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-green-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
                data-testid="refresh-spinner"
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
              <span>Refreshing streams…</span>
            </>
          ) : (
            <>
              <svg
                className="h-5 w-5 text-green-400 transition-transform duration-200"
                style={{
                  transform: `rotate(${progress >= 1 ? 180 : progress * 180}deg)`,
                }}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
              <span>
                {pullDistance >= PULL_THRESHOLD
                  ? "Release to refresh"
                  : "Pull down to refresh"}
              </span>
            </>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}

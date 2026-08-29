"use client";

import { useTheme } from "@/src/lib/theme";

/** Sun icon (light mode indicator). */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

/** Moon icon (dark mode indicator). */
function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Monitor icon (system preference indicator). */
function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

/**
 * Theme toggle button for the app header.
 *
 * - Reads system colour-scheme preference on first load (#519).
 * - Persists explicit user choice to localStorage via ThemeProvider (#519).
 * - Theme is applied before first paint via the inline script in layout.tsx
 *   to prevent a flash of unstyled content (#519).
 * - Shows a sun/moon icon that reflects the current mode.
 * - "Auto" badge appears when the user has overridden the system preference
 *   and can be clicked to revert to system tracking.
 * - Announces theme changes to screen readers via aria-live.
 */
export default function ThemeToggle() {
  const { theme, isSystem, toggle, useSystemTheme } = useTheme();
  const isDark = theme === "dark" || theme === "high-contrast";

  const currentLabel = isDark ? "Dark" : "Light";
  const nextLabel = isDark ? "Light" : "Dark";
  const ariaLabel = `Switch to ${nextLabel.toLowerCase()} theme (currently ${currentLabel.toLowerCase()})`;

  const titleText = isSystem
    ? `Theme: auto (${currentLabel.toLowerCase()}, following system)`
    : theme === "high-contrast"
    ? "Theme: high contrast"
    : `Theme: ${currentLabel.toLowerCase()} (set manually — click Auto to follow system)`;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Theme controls">
      {/* aria-live region so screen readers announce theme changes */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {currentLabel} theme active{isSystem ? ", following system preference" : ""}
      </span>

      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
        aria-label={ariaLabel}
        aria-pressed={isDark}
        title={titleText}
      >
        {isDark ? (
          <MoonIcon className="h-4 w-4" />
        ) : (
          <SunIcon className="h-4 w-4" />
        )}
        <span className="hidden sm:inline text-xs">{currentLabel}</span>
      </button>

      {/* "Auto" reset button — only visible when user has an explicit override */}
      {!isSystem && (
        <button
          onClick={useSystemTheme}
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded-md px-1.5 py-1 border border-gray-300 dark:border-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
          aria-label="Follow system colour-scheme preference"
          title="Reset to system preference"
        >
          <MonitorIcon className="h-3 w-3" />
          <span>Auto</span>
        </button>
      )}
    </div>
  );
}

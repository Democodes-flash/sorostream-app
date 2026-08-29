"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getUserTimezone,
  listTimezones,
  zonedWallTimeToUtc,
  formatWallTimeInZone,
  formatDateWithTimezone,
} from "@/src/lib/timezone";

interface EndDatePickerProps {
  /** Current value as an absolute ISO UTC string ("" when unset). */
  value?: string;
  /** Called with the resolved ISO UTC string (or "" when cleared). */
  onChange: (isoUtc: string) => void;
  /** Called with the duration in seconds from now until the chosen instant. */
  onDurationResolved?: (seconds: number) => void;
  error?: string;
  id?: string;
}

function formatRelative(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * Returns a datetime-local string (YYYY-MM-DDTHH:MM) for the current moment,
 * used as the `min` attribute to prevent selecting past dates in the browser UI.
 */
function nowAsDatetimeLocal(): string {
  const now = new Date();
  // Offset by the local timezone so datetime-local reflects wall-clock "now"
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Timezone-aware end-date/time picker (#427) — an alternative to entering a
 * raw duration. The user picks an instant in any IANA timezone; the absolute
 * UTC time is reported via `onChange` and the equivalent duration from now
 * via `onDurationResolved`.
 *
 * Validates that the selected instant is strictly in the future (#487).
 */
export default function EndDatePicker({
  value = "",
  onChange,
  onDurationResolved,
  error,
  id = "end-date",
}: EndDatePickerProps) {
  const [timezone, setTimezone] = useState<string>("");
  const [wallTime, setWallTime] = useState<string>("");
  const [internalError, setInternalError] = useState<string>("");

  const timezoneOptions = useMemo(() => listTimezones(), []);

  // Initialise timezone + input display from props once on mount.
  useEffect(() => {
    let tz = getUserTimezone();
    if (!listTimezones().includes(tz)) tz = "UTC";
    setTimezone(tz);
    if (value) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) setWallTime(formatWallTimeInZone(d, tz));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resolve(wall: string, tz: string) {
    setWallTime(wall);
    if (!wall) {
      setInternalError("");
      onChange("");
      onDurationResolved?.(0);
      return;
    }
    const utc = zonedWallTimeToUtc(wall, tz || getUserTimezone());
    if (!utc) return;

    // Validate: the chosen instant must be strictly in the future.
    if (utc.getTime() <= Date.now()) {
      setInternalError("End date must be in the future.");
      onChange("");
      onDurationResolved?.(0);
      return;
    }

    setInternalError("");
    onChange(utc.toISOString());
    onDurationResolved?.(Math.max(0, Math.round((utc.getTime() - Date.now()) / 1000)));
  }

  const previewUtc = wallTime ? zonedWallTimeToUtc(wallTime, timezone || getUserTimezone()) : null;
  const durationSeconds =
    previewUtc && previewUtc.getTime() > Date.now()
      ? Math.round((previewUtc.getTime() - Date.now()) / 1000)
      : null;

  // Prefer the externally supplied error over the internal one so the parent
  // can override with its own validation message.
  const displayError = error || internalError;

  return (
    <div>
      <label htmlFor={id} className="text-gray-200 text-sm font-medium block mb-2">
        End Date &amp; Time <span className="text-gray-400 font-normal">(optional — sets the stream duration)</span>
      </label>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id={id}
          type="datetime-local"
          value={wallTime}
          min={nowAsDatetimeLocal()}
          onChange={(e) => resolve(e.target.value, timezone)}
          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          aria-invalid={!!displayError}
          aria-describedby={
            displayError ? `${id}-error` : previewUtc ? `${id}-preview` : undefined
          }
        />
        <select
          value={timezone}
          onChange={(e) => {
            const tz = e.target.value;
            setTimezone(tz);
            // Same wall-clock reading re-interpreted in the new timezone.
            if (wallTime) resolve(wallTime, tz);
          }}
          aria-label="Timezone for end date"
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-3 text-white text-sm max-w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {!timezoneOptions.includes(timezone) && timezone && (
            <option value={timezone}>{timezone}</option>
          )}
          {timezoneOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      {previewUtc && durationSeconds !== null && (
        <p id={`${id}-preview`} className="text-xs text-slate-400 mt-1" aria-live="polite">
          {formatDateWithTimezone(previewUtc)} · UTC{" "}
          {previewUtc.toISOString().slice(0, 16).replace("T", " ")}
          {durationSeconds !== null && (
            <>
              {" "}
              · <span className="text-green-400">≈ {formatRelative(durationSeconds)} from now</span>
            </>
          )}
        </p>
      )}

      {displayError && (
        <p
          id={`${id}-error`}
          role="alert"
          aria-live="polite"
          className="text-red-400 text-sm mt-1"
        >
          {displayError}
        </p>
      )}
    </div>
  );
}

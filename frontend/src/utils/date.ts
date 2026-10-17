/**
 * Date and timezone formatting utilities.
 * All timestamps are converted and displayed in Indian Standard Time (IST, Asia/Kolkata, UTC+05:30).
 *
 * All functions accept string | Date | number | null | undefined and never throw or
 * return "Invalid Date". They are safe to call with any API response value.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Safely parse a timestamp into a Date object.
 * If the input is a naive ISO string without timezone (common from SQL/APIs),
 * it is normalized to UTC (by appending 'Z') so the browser does not misinterpret
 * it as local time, preventing 5h 30m offset skew.
 */
export function parseDate(ts: string | Date | number | null | undefined): Date | null {
  if (ts == null) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'string') {
    let s = ts.trim();
    if (!s) return null;
    // Normalize naive strings like "2026-10-16 14:30:00" or "2026-10-16T14:30:00" to UTC
    if (!s.endsWith('Z') && !/[+-]\d{2}(?::?\d{2})?$/.test(s)) {
      s = s.replace(' ', 'T') + 'Z';
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Format a timestamp as a human-readable date+time string in IST (Asia/Kolkata).
 * e.g. "16 Oct 2026, 08:30 PM IST"
 */
export function formatDate(ts: string | Date | number | null | undefined): string {
  const d = parseDate(ts);
  if (!d) return '—';
  try {
    const formatted = d.toLocaleString('en-IN', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `${formatted} IST`;
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Format timestamp as a time-only string in IST (Asia/Kolkata).
 * e.g. "08:30:15 PM IST"
 */
export function formatTime(ts: string | Date | number | null | undefined): string {
  const d = parseDate(ts);
  if (!d) return '—';
  try {
    const formatted = d.toLocaleTimeString('en-IN', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return `${formatted} IST`;
  } catch {
    return d.toLocaleTimeString();
  }
}

/**
 * Format as a short date (no time) in IST (Asia/Kolkata).
 * e.g. "16 Oct 2026"
 */
export function formatDateShort(ts: string | Date | number | null | undefined): string {
  const d = parseDate(ts);
  if (!d) return '—';
  try {
    return d.toLocaleDateString('en-IN', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Format as a relative time string ("2m ago", "just now", "in 5m") calculated against current IST epoch.
 * Falls back to formatDate (in IST) if older than 7 days.
 */
export function formatRelative(ts: string | Date | number | null | undefined): string {
  const d = parseDate(ts);
  if (!d) return '—';

  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(Math.abs(diffMs) / 1000);
  const isFuture = diffMs < 0;

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return isFuture ? `in ${diffSec}s` : `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return isFuture ? `in ${diffMin}m` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isFuture ? `in ${diffHr}h` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay <= 7) return isFuture ? `in ${diffDay}d` : `${diffDay}d ago`;

  // Older than 7 days — show formatted IST date
  return formatDateShort(d);
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * e.g. 1234 → "1.2s", 123 → "123ms"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a latency value (in ms) with color hints as a string.
 * e.g. 45 → "45ms", 1500 → "1.5s"
 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

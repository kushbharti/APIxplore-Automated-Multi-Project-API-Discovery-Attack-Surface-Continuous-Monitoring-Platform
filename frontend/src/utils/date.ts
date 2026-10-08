/**
 * Date formatting utilities.
 *
 * All functions accept string | null | undefined and never throw or
 * return "Invalid Date". They are safe to call with any API response value.
 */

/**
 * Format a timestamp as a human-readable date+time string.
 * Returns "—" for null/undefined or unparseable values.
 * Never returns "Invalid Date".
 */
export function formatDate(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


/**
 * Format as a short date (no time).
 * Returns "—" for null/undefined or unparseable values.
 */
export function formatDateShort(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format as a relative time string ("2 hours ago", "just now", "in 5 minutes").
 * Falls back to formatDate if the relative time would be more than 7 days.
 * Returns "—" for null/undefined or unparseable values.
 */
export function formatRelative(ts: string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '—';

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

  // Older than 7 days — show the actual date
  return formatDateShort(ts);
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

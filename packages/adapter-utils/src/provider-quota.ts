import type { AdapterExecutionErrorFamily } from "./types.js";

/**
 * Shared, adapter-agnostic classification of provider failure text into the
 * `errorFamily` / `retryNotBefore` recovery contract. Gateway-style adapters
 * (OpenClaw) relay upstream failover errors verbatim without structured codes,
 * so classification has to work from the message text alone.
 *
 * Kept browser-safe (pure, no Node imports) because the root adapter-utils
 * entry is imported by the UI.
 */
export interface ProviderFailureClassification {
  errorFamily: Extract<AdapterExecutionErrorFamily, "provider_quota" | "transient_upstream"> | null;
  /** ISO8601 deadline before which a retry is guaranteed to fail again. */
  retryNotBefore: string | null;
}

// Quota exhaustion is terminal until the provider's reset: retrying earlier can
// never succeed, so these must NOT fall into the generic transient bucket.
const PROVIDER_QUOTA_RE =
  /(?:you(?:'|’)ve (?:hit|reached) your[^\n]{0,60}?usage limit|subscription usage limit|usage limit (?:reached|exceeded)|usage cap reached|session limit (?:reached|exceeded)|provider quota|quota (?:limit )?exceeded|quota exhausted|out of extra usage|model (?:is )?at capacity)/i;

// Provider-side cooldown / rate limiting: retry is possible, but only with
// backoff — immediate retries just extend the cooldown (retry storm).
const PROVIDER_COOLDOWN_RE =
  /(?:provider\s+[\w./-]+\s+is\s+in\s+cooldown|suspending lanes|\(rate_limit\)|rate[-\s]?limit(?:ed)?\b|too many requests|\b429\b|server overloaded|overloaded_error|service unavailable|\b503\b|\b529\b|high demand|try again later|temporarily unavailable)/i;

// "Next reset in 3 days, Aug 20 at 5:28 AM GMT" (Codex subscription limits).
const RESET_ABSOLUTE_RE =
  /next\s+reset(?:\s+in\s+[^,\n]{1,40},)?\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2}):(\d{2})\s*([AaPp])?\.?[Mm]?\.?\s*([A-Za-z]{2,5})?/i;

// "Next reset in 2 hours" — fallback when no absolute clock is given.
const RESET_RELATIVE_RE = /next\s+reset\s+in\s+(\d+)\s+(minute|hour|day)s?\b/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const YEAR_ROLLOVER_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const RELATIVE_UNIT_MS: Record<string, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

function parseAbsoluteReset(text: string, now: Date): Date | null {
  const match = text.match(RESET_ABSOLUTE_RE);
  if (!match) return null;

  const month = MONTHS[(match[1] ?? "").slice(0, 3).toLowerCase()];
  const day = Number.parseInt(match[2] ?? "", 10);
  const hourValue = Number.parseInt(match[3] ?? "", 10);
  const minute = Number.parseInt(match[4] ?? "", 10);
  const meridiem = (match[5] ?? "").toLowerCase();
  const zone = (match[6] ?? "").toUpperCase();

  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hourValue)) return null;
  if (meridiem ? hourValue < 1 || hourValue > 12 : hourValue < 0 || hourValue > 23) return null;
  // Only GMT/UTC (or an omitted zone, treated as UTC) can be computed without
  // a timezone database; anything else would silently mis-time the deadline.
  if (zone && zone !== "GMT" && zone !== "UTC") return null;

  let hour = meridiem ? hourValue % 12 : hourValue;
  if (meridiem === "p") hour += 12;

  const computed = new Date(Date.UTC(now.getUTCFullYear(), month, day, hour, minute, 0, 0));
  if (computed.getTime() > now.getTime()) return computed;

  // A month-day in the past is either a December→January rollover or a stale
  // message replay; only bump the year for a plausibly-near rollover.
  const bumped = new Date(Date.UTC(now.getUTCFullYear() + 1, month, day, hour, minute, 0, 0));
  return bumped.getTime() - now.getTime() <= YEAR_ROLLOVER_WINDOW_MS ? bumped : null;
}

function parseRelativeReset(text: string, now: Date): Date | null {
  const match = text.match(RESET_RELATIVE_RE);
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? "", 10);
  const unitMs = RELATIVE_UNIT_MS[(match[2] ?? "").toLowerCase()];
  if (!Number.isInteger(amount) || amount <= 0 || !unitMs) return null;
  return new Date(now.getTime() + amount * unitMs);
}

export function extractProviderResetTime(text: string, now = new Date()): Date | null {
  if (!text) return null;
  return parseAbsoluteReset(text, now) ?? parseRelativeReset(text, now);
}

export function classifyProviderFailure(
  text: string | null | undefined,
  now = new Date(),
): ProviderFailureClassification {
  const haystack = text ?? "";
  if (!haystack.trim()) return { errorFamily: null, retryNotBefore: null };

  if (PROVIDER_QUOTA_RE.test(haystack)) {
    const resetAt = extractProviderResetTime(haystack, now);
    return {
      errorFamily: "provider_quota",
      retryNotBefore: resetAt ? resetAt.toISOString() : null,
    };
  }

  if (PROVIDER_COOLDOWN_RE.test(haystack)) {
    const resetAt = extractProviderResetTime(haystack, now);
    return {
      errorFamily: "transient_upstream",
      retryNotBefore: resetAt ? resetAt.toISOString() : null,
    };
  }

  return { errorFamily: null, retryNotBefore: null };
}

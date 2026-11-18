import type { PushRecord } from "./record";

// The rules of the check (docs: the relay's design, "Expiry and
// renewal"), as plain functions of what is known.

export const DAY_MS = 24 * 60 * 60 * 1000;

// An endpoint is renewed once it is this old, long before the relay's
// expiry, so a phone opened now and then never lets one lapse.
export const RENEW_AGE_MS = 7 * DAY_MS;

// Backoff after a failure: a minute, doubling, at most six hours, or
// longer when the relay's Retry-After says so.
const FIRST_RETRY_MS = 60 * 1000;
const LAST_RETRY_MS = 6 * 60 * 60 * 1000;

// Why the subscription must be made again, or null when the server need
// only be told the kinds. The record is the one for this sign-in, or
// null when there is none.
export function renewReason(
  record: PushRecord | null,
  now: number,
  deviceToken: string,
  serverKey: string,
): string | null {
  if (!record) return "no subscription";
  if (record.deviceToken !== deviceToken) return "device token changed";
  if (record.vapidKey !== serverKey) return "server key changed";
  if (record.issuedAt > now) return "issued in the future";
  if (now - record.issuedAt >= RENEW_AGE_MS) return "7 days old";
  // Only for a relay whose endpoints live under two weeks.
  if (record.expiresAt - now < RENEW_AGE_MS) return "expires within 7 days";
  return null;
}

// Whether a check completed within the last day. A time ahead of now
// (the clock was set back) is not recent.
export function checkedWithinDay(checkedAt: number | undefined, now: number): boolean {
  return checkedAt !== undefined && checkedAt <= now && now - checkedAt < DAY_MS;
}

// How long to wait before trying again after this many failures in a row.
export function retryDelayMs(failures: number, retryAfterMs: number | null): number {
  const doubled = FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1);
  return Math.max(Math.min(doubled, LAST_RETRY_MS), retryAfterMs ?? 0);
}

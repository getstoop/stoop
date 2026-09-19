import { formatBytes } from "../bytes";

// The tab's two clocks: how long the server has been up, and how long ago
// something was read.

export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ---- Background work ----

const JOB_LABELS: Record<string, string> = {
  file_sweep: "File sweep",
  attachment_retention: "Attachment retention",
  message_retention: "Message retention",
  activity_retention: "Activity retention",
  credential_sweep: "Credential sweep",
  delivery_log_sweep: "Delivery log sweep",
  webhook_worker: "Webhook worker",
};

export function jobLabel(name: string): string {
  return JOB_LABELS[name] ?? name;
}

// A span in the largest unit that fits: "6 h", "1.5 h", "5 min", "30 s".
function span(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s >= 86400) return `${trim(s / 86400)} d`;
  if (s >= 3600) return `${trim(s / 3600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)} s`;
}

function trim(n: number): string {
  const one = Math.round(n * 10) / 10;
  return Number.isInteger(one) ? String(one) : one.toFixed(1);
}

export function formatEvery(ms: number | undefined): string {
  return ms === undefined ? "continuous" : span(ms);
}

export function agoWords(ms: number): string {
  return `${span(ms)} ago`;
}

export function untilWords(ms: number): string {
  return ms <= 0 ? "due now" : `in ${span(ms)}`;
}

export function formatTook(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function plural(n: bigint | number, one: string, many: string): string {
  return `${n} ${n === 1 || n === 1n ? one : many}`;
}

// Each counter a pass can report, in the order the sentence says them.
const PHRASES: [string, (n: bigint) => string][] = [
  ["files_removed", (n) => `removed ${plural(n, "file", "files")}`],
  ["bytes_freed", (n) => `freed ${formatBytes(n)}`],
  ["stray_blobs_removed", (n) => plural(n, "stray blob", "stray blobs")],
  [
    "attachments_removed",
    (n) => `removed ${plural(n, "attachment", "attachments")}`,
  ],
  ["messages_removed", (n) => `removed ${plural(n, "message", "messages")}`],
  ["rows_trimmed", (n) => `trimmed ${plural(n, "row", "rows")}`],
  [
    "credentials_expired",
    (n) => `expired ${plural(n, "credential", "credentials")}`,
  ],
  [
    "deliveries_removed",
    (n) => `removed ${plural(n, "delivery", "deliveries")}`,
  ],
  ["delivered", (n) => `delivered ${n}`],
  ["failed", (n) => `${n} failed`],
];

export function countersSentence(counters: Record<string, bigint>): string {
  const keys = Object.keys(counters);
  if (keys.every((k) => counters[k] === 0n)) return "nothing to remove";
  const said = new Set<string>();
  const parts: string[] = [];
  for (const [key, phrase] of PHRASES) {
    if (key in counters) {
      parts.push(phrase(counters[key]));
      said.add(key);
    }
  }
  for (const key of keys.filter((k) => !said.has(k)).sort()) {
    parts.push(`${key} ${counters[key]}`);
  }
  return parts.join(" · ");
}

export function queueSentence(q: {
  queued: bigint;
  leased: bigint;
  dead: bigint;
}): string {
  return `${q.queued} queued · ${q.leased} in flight · ${q.dead} dead-lettered`;
}

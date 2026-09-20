import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type Job,
  JobOutcome,
  type QueueStats,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import {
  agoWords,
  countersSentence,
  formatEvery,
  formatTook,
  jobLabel,
  queueSentence,
  untilWords,
} from "./format";

// One row per background loop, from the job recorder; the worker's row
// reads the queue instead of its own counters. The columns are fixed, so
// each row carries what the cells say and what they sort by. A sweeper
// that is switched off has no interval and never ran: "off", and dashes.

export type Badge = { className: string; label: string };

export type JobRow = {
  name: string;
  label: string;
  everyMs?: number;
  every: string;
  lastMs?: number;
  lastRun: string;
  tookMs: number;
  took: string;
  badge?: Badge;
  result: string;
  nextMs?: number;
  next: string;
};

const BADGE: Partial<Record<JobOutcome, Badge>> = {
  [JobOutcome.SUCCEEDED]: { className: "badge ok", label: "ok" },
  [JobOutcome.RUNNING]: { className: "badge warn", label: "running" },
  [JobOutcome.FAILED]: { className: "badge danger", label: "failed" },
};
const WARN: Badge = { className: "badge warn", label: "warn" };

export function toRow(
  job: Job,
  webhooks: QueueStats | undefined,
  now: number,
): JobRow {
  const everyMs = job.interval
    ? Number(job.interval.seconds) * 1000 + job.interval.nanos / 1e6
    : undefined;
  const lastMs = job.lastStarted
    ? timestampDate(job.lastStarted).getTime()
    : undefined;
  const nextMs = job.nextDue ? timestampDate(job.nextDue).getTime() : undefined;
  const base = { name: job.name, label: jobLabel(job.name) };
  if (everyMs === undefined && !job.continuous && lastMs === undefined) {
    return {
      ...base,
      every: "off",
      lastRun: "—",
      tookMs: 0,
      took: "—",
      result: "—",
      next: "—",
    };
  }
  let badge = BADGE[job.lastOutcome];
  let result = "";
  if (job.name === "webhook_worker" && webhooks) {
    result = queueSentence(webhooks);
    // Warn on what is recent; the sentence carries the all-time count.
    if (webhooks.deadLastHour > 0n && job.lastOutcome !== JobOutcome.FAILED)
      badge = WARN;
  } else if (job.lastOutcome === JobOutcome.FAILED) {
    result = job.lastError;
  } else if (lastMs !== undefined) {
    result = countersSentence(job.counters);
  }
  return {
    ...base,
    everyMs,
    every: formatEvery(everyMs, job.continuous),
    lastMs,
    lastRun: lastMs === undefined ? "never" : agoWords(now - lastMs),
    tookMs: job.lastDurationMs,
    took: lastMs === undefined ? "—" : formatTook(job.lastDurationMs),
    badge,
    result,
    nextMs,
    next: nextMs === undefined ? "—" : untilWords(nextMs - now),
  };
}

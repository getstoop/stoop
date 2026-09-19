import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useMemo } from "react";
import { useDiagJobs } from "../../../api/queries";
import { DataTable, type TableColumn } from "../../../components/DataTable";
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
// each row carries what the cells say and what they sort by.

type Badge = { className: string; label: string };

type JobRow = {
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

function toRow(
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
    name: job.name,
    label: jobLabel(job.name),
    everyMs,
    every: formatEvery(everyMs),
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

const columns: TableColumn<JobRow>[] = [
  {
    id: "job",
    header: "Job",
    accessorFn: (r) => r.label,
    cell: ({ row: { original: r } }) => r.label,
  },
  {
    id: "every",
    header: "Every",
    accessorFn: (r) => r.everyMs ?? 0,
    meta: { width: "14%" },
    cell: ({ row: { original: r } }) => r.every,
  },
  {
    id: "last",
    header: "Last run",
    accessorFn: (r) => r.lastMs ?? 0,
    meta: { width: "13%" },
    cell: ({ row: { original: r } }) => r.lastRun,
  },
  {
    id: "took",
    header: "Took",
    accessorFn: (r) => r.tookMs,
    meta: { width: "9%", align: "end" },
    cell: ({ row: { original: r } }) => r.took,
  },
  {
    id: "result",
    header: "Result",
    enableSorting: false,
    meta: { width: "31%" },
    cell: ({ row: { original: r } }) => (
      <span className="jobs-result">
        {r.badge && <span className={r.badge.className}>{r.badge.label}</span>}
        <span className="muted">{r.result}</span>
      </span>
    ),
  },
  {
    id: "next",
    header: "Next",
    accessorFn: (r) => r.nextMs ?? 0,
    meta: { width: "11%" },
    cell: ({ row: { original: r } }) => r.next,
  },
];

const rowId = (r: JobRow) => r.name;
const rowProps = (r: JobRow) => ({ "data-job": r.name });

export function JobsTable({ now }: { now: number }) {
  const { data, error, isPending } = useDiagJobs();
  const rows = useMemo(
    () => data?.jobs.map((j) => toRow(j, data.webhooks, now)),
    [data, now],
  );
  return (
    <section className="card" data-testid="jobs-section">
      <h3>Background work</h3>
      <p className="hint">Every scheduled job and the webhook queue.</p>
      {error ? (
        <p className="error" role="alert">
          Could not read background work: {error.message}
        </p>
      ) : isPending ? (
        <div className="centered muted">Loading…</div>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowId={rowId}
          rowProps={rowProps}
          noun={["job", "jobs"]}
          empty="No background work is registered."
          pageSize={10}
        />
      )}
    </section>
  );
}

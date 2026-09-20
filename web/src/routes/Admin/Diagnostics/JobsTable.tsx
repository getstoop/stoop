import { useMemo } from "react";
import { useDiagJobs } from "../../../api/queries";
import { DataTable, type TableColumn } from "../../../components/DataTable";
import { type JobRow, toRow } from "./jobRow";

// The Background work table; the rows come from jobRow.ts.

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

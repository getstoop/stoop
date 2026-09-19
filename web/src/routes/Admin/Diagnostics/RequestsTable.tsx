import { useState } from "react";
import { useDiagRequests } from "../../../api/queries";
import { DataTable, type TableColumn } from "../../../components/DataTable";
import {
  type ProcedureStats,
  StatsWindow,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { formatDuration } from "./format";

// One row per procedure called in the window, slowest p95 first as the
// server orders them. The timings are the interceptor's, so they cover
// the handler and every interceptor inside it, not the network.

// A p95 at or above this is drawn hot.
const HOT_US = 200_000;

const WINDOWS: { window: StatsWindow; label: string }[] = [
  { window: StatsWindow.LAST_5_MINUTES, label: "Last 5 min" },
  { window: StatsWindow.SINCE_START, label: "Since start" },
];

const duration = (us: number) => (
  <span title={`${us} µs`}>{formatDuration(us)}</span>
);

const columns: TableColumn<ProcedureStats>[] = [
  {
    id: "procedure",
    header: "Procedure",
    accessorFn: (p) => p.procedure,
    cell: ({ row: { original: p } }) => (
      <span className="diag-mono">{p.procedure}</span>
    ),
  },
  {
    id: "calls",
    header: "Calls",
    accessorFn: (p) => Number(p.calls),
    meta: { width: "11%", align: "end" },
    cell: ({ row: { original: p } }) => String(p.calls),
  },
  {
    id: "errors",
    header: "Errors",
    accessorFn: (p) => Number(p.errors),
    meta: { width: "11%", align: "end" },
    cell: ({ row: { original: p } }) => String(p.errors),
  },
  {
    id: "p50",
    header: "p50",
    accessorFn: (p) => p.p50Us,
    meta: { width: "11%", align: "end" },
    cell: ({ row: { original: p } }) => duration(p.p50Us),
  },
  {
    id: "p95",
    header: "p95",
    accessorFn: (p) => p.p95Us,
    meta: { width: "11%", align: "end" },
    cell: ({ row: { original: p } }) => (
      <span className={p.p95Us >= HOT_US ? "hot" : undefined}>
        {duration(p.p95Us)}
      </span>
    ),
  },
  {
    id: "max",
    header: "Max",
    accessorFn: (p) => p.maxUs,
    meta: { width: "11%", align: "end" },
    cell: ({ row: { original: p } }) => duration(p.maxUs),
  },
];

export function RequestsTable() {
  const [window, setWindow] = useState(StatsWindow.LAST_5_MINUTES);
  const { data, error } = useDiagRequests(window);
  const count = data?.procedures.length;
  return (
    <section className="card" data-testid="requests-section">
      <h3>Requests</h3>
      <p className="hint">
        Slowest first. Times are server-side, from the interceptor.
      </p>
      {error ? (
        <p className="error" role="alert">
          Could not read requests: {error.message}
        </p>
      ) : (
        <>
          <div className="diag-toolbar">
            {WINDOWS.map((w) => (
              <button
                key={w.window}
                type="button"
                className={`chip ${w.window === window ? "active" : ""}`}
                aria-pressed={w.window === window}
                onClick={() => setWindow(w.window)}
              >
                {w.label}
              </button>
            ))}
            {count !== undefined && (
              <span className="dt-count muted small">
                {count} {count === 1 ? "procedure" : "procedures"}
              </span>
            )}
          </div>
          <DataTable
            rows={data?.procedures}
            columns={columns}
            rowId={(p) => p.procedure}
            noun={["procedure", "procedures"]}
            empty="No requests in this window yet."
            pageSize={10}
            rowProps={(p) => ({ "data-procedure": p.procedure })}
          />
        </>
      )}
    </section>
  );
}

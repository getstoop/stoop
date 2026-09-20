import { useDiagDatabase } from "../../../api/queries";
import type { GetDatabaseStatsResponse } from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { formatBytes } from "../bytes";

// Database: the pool as pgxpool sees it, and the server as pg_stat_activity
// sees it. Read-only; the pool size is STOOP_DATABASE_URL's.

export function DatabasePanel() {
  const { data, error, isPending } = useDiagDatabase();
  return (
    <section className="card" data-testid="database-section">
      <div className="diag-head">
        <h3>Database</h3>
        <p className="hint">
          pgxpool and pg_stat_activity, this database only.
        </p>
      </div>
      {error ? (
        <p className="error" role="alert">
          Could not read database stats: {error.message}
        </p>
      ) : isPending ? (
        <div className="centered muted">Loading…</div>
      ) : (
        <Facts d={data} />
      )}
    </section>
  );
}

function Facts({ d }: { d: GetDatabaseStatsResponse }) {
  const waits = Number(d.acquireWaits);
  return (
    <div className="facts">
      <Fact label="Pool in use">
        {d.poolAcquired} of {d.poolMax}
        <PoolMeter used={d.poolAcquired} max={d.poolMax} />
      </Fact>
      <Fact label="Waited for a connection">
        {waits === 0
          ? "never"
          : `${waits} ${waits === 1 ? "time" : "times"}, ${formatMs(Number(d.acquireWaitMs))} total`}
      </Fact>
      <Fact label="Ping">{formatUs(d.pingUs)}</Fact>
      <Fact label="Size on disk">{formatBytes(d.databaseBytes)}</Fact>
      <Fact label="Backends">
        {d.backendsActive} active · {d.backendsIdle} idle
      </Fact>
      <Fact label="Oldest transaction">
        {d.oldestTransactionMs === 0 ? "none" : formatMs(d.oldestTransactionMs)}
      </Fact>
      <Fact label="Schema">
        goose {String(d.schemaVersion)} · floor {String(d.schemaFloor)}
      </Fact>
      <Fact label="Server">PostgreSQL {d.serverVersion}</Fact>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fact">
      <span className="fact-label muted">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}

function PoolMeter({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const state = used >= max ? "full" : pct >= 75 ? "warn" : "";
  return (
    <div
      className={`storage-bar ${state}`}
      role="progressbar"
      aria-label="Pool connections in use"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={used}
    >
      <div className="storage-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatUs(us: number): string {
  if (us < 1000) return `${us} µs`;
  return formatMs(us / 1000);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

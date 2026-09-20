import { useDiagLiveStats } from "../../../api/queries";
import type { Gauge } from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { Sparkline } from "./Sparkline";

// Right now: one tile per gauge, each a value, its last fifteen minutes
// and one line of context. Names are the server's
// (docs/proposals/diagnostics.md).

type Tile = {
  name: string;
  label: string;
  sub: (g: Map<string, Gauge>) => string;
};

const TILES: Tile[] = [
  {
    name: "connections",
    label: "Connections",
    sub: () => "WebSocket sessions",
  },
  {
    name: "online_users",
    label: "Online people",
    sub: () => "accounts with a connection",
  },
  {
    name: "voice_participants",
    label: "In voice",
    sub: (g) => plural(value(g, "voice_rooms"), "room"),
  },
  {
    name: "requests_per_minute",
    label: "Requests / min",
    sub: (g) => plural(value(g, "request_errors_per_minute"), "error"),
  },
  {
    name: "bus_dropped_total",
    label: "Slow consumers",
    sub: () => "dropped from the event bus, since start",
  },
];

function value(g: Map<string, Gauge>, name: string): number {
  return g.get(name)?.value ?? 0;
}

function plural(n: number, noun: string): string {
  const r = formatValue(n);
  return `${r} ${noun}${r === "1" ? "" : "s"}`;
}

function formatValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function LiveTiles() {
  const { data, error, isPending } = useDiagLiveStats();
  return (
    <section className="card" data-testid="live-section">
      <div className="diag-head">
        <h3>Right now</h3>
        <p className="hint">Last 15 minutes, one sample every 10 s.</p>
      </div>
      {error ? (
        <p className="error" role="alert">
          Could not read live stats: {error.message}
        </p>
      ) : isPending ? (
        <div className="centered muted">Loading…</div>
      ) : (
        <Tiles gauges={new Map(data.gauges.map((g) => [g.name, g]))} />
      )}
    </section>
  );
}

function Tiles({ gauges }: { gauges: Map<string, Gauge> }) {
  return (
    <div className="tiles">
      {TILES.map((t) => {
        const g = gauges.get(t.name);
        return (
          <div className="tile" key={t.name} data-gauge={t.name}>
            <span className="tile-title" title={t.label}>
              {t.label}
            </span>
            <span className="tile-value">{formatValue(g?.value ?? 0)}</span>
            <Sparkline series={g?.series ?? []} />
            <span className="tile-sub muted">{t.sub(gauges)}</span>
          </div>
        );
      })}
    </div>
  );
}

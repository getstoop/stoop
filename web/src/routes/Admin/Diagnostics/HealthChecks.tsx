import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Link } from "@tanstack/react-router";
import { useDiagHealth } from "../../../api/queries";
import {
  CheckState,
  type HealthCheck,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { ago } from "./format";

// One row per dependency: what it is, how it is, the one line the check
// wrote, and how fresh that is. The state is drawn as given; the
// thresholds are the server's (docs/proposals/diagnostics.md). A state
// this build does not know (a newer server) draws as unknown.

const BADGE: Record<CheckState, { className: string; label: string }> = {
  [CheckState.UNSPECIFIED]: { className: "badge off", label: "unknown" },
  [CheckState.OK]: { className: "badge ok", label: "ok" },
  [CheckState.WARN]: { className: "badge warn", label: "warn" },
  [CheckState.DANGER]: { className: "badge danger", label: "danger" },
  [CheckState.OFF]: { className: "badge off", label: "off" },
};

const FIX_TABS: Record<
  string,
  { tab: "hosting" | "storage" | "integrations"; label: string }
> = {
  hosting: { tab: "hosting", label: "see Hosting" },
  storage: { tab: "storage", label: "see Storage" },
  integrations: { tab: "integrations", label: "see Integrations" },
};

export function HealthChecks({ now }: { now: number }) {
  const { data, error, isPending } = useDiagHealth();
  return (
    <section className="card" data-testid="health-section">
      <h3>Health</h3>
      {error ? (
        <p className="error" role="alert">
          Could not read health: {error.message}
        </p>
      ) : isPending ? (
        <div className="centered muted">Loading…</div>
      ) : (
        <div className="health-box">
          {data.checks.map((c) => (
            <HealthRow key={c.name} check={c} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

function HealthRow({ check, now }: { check: HealthCheck; now: number }) {
  const badge = BADGE[check.state] ?? BADGE[CheckState.UNSPECIFIED];
  const fix = FIX_TABS[check.fixTab];
  const checked = check.checkedAt
    ? ago(now - timestampDate(check.checkedAt).getTime())
    : "";
  return (
    <div className="health-row" data-check={check.name}>
      <span className="health-name">{check.name}</span>
      <span className={badge.className}>{badge.label}</span>
      <span className="health-detail">
        <span className="health-text" title={check.detail}>
          {check.detail}
        </span>
        {fix && (
          <Link to="/admin" search={{ tab: fix.tab }}>
            {fix.label}
          </Link>
        )}
      </span>
      <span className="health-age muted">{checked}</span>
    </div>
  );
}

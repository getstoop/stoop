import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  useBuildInfo,
  useDiagHealth,
  useInstanceStatus,
} from "../../../api/queries";
import { DatabasePanel } from "./DatabasePanel";
import { ago, formatUptime } from "./format";
import { HealthChecks } from "./HealthChecks";
import { LiveTiles } from "./LiveTiles";
import { useNow } from "./useNow";

// The Diagnostics tab: what the server is doing across its dependencies,
// read-only, refreshed while the tab is open. One section per panel; each
// keeps its own query so a failed one is one error line, not a blank page.
export function Diagnostics() {
  const now = useNow();
  const { data: status } = useInstanceStatus();
  const { data: build } = useBuildInfo(true);
  const { data: health, dataUpdatedAt } = useDiagHealth();
  const startedAt = health?.serverStartedAt
    ? timestampDate(health.serverStartedAt).getTime()
    : undefined;
  const line = [
    status?.instanceName,
    build && `v${build.version}${build.commit ? ` (${build.commit})` : ""}`,
    startedAt !== undefined && `up ${formatUptime(now - startedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className="diag-meta">
        <p className="hint">{line}</p>
        <p className="hint">
          {dataUpdatedAt
            ? `Refreshed ${ago(now - dataUpdatedAt)}`
            : "Refreshing…"}
          {" · every 5 s while this tab is open"}
        </p>
      </div>
      <HealthChecks now={now} />
      <LiveTiles />
      <DatabasePanel />
    </>
  );
}

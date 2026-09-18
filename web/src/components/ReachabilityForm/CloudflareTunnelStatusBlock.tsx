import type { CloudflareTunnelStatus } from "../../gen/stoop/instance/v1/reachability_pb";

// What the connector is doing right now, as the server reports it.
export function CloudflareTunnelStatusBlock({
  status,
}: {
  status: CloudflareTunnelStatus;
}) {
  return (
    <div className="reach-tunnel-status" data-state={status.state}>
      <span className="reach-status-label">Status:</span>
      {!status.enabled && status.state !== "missing" && (
        <p className="hint">Not running.</p>
      )}
      {status.enabled && status.state === "starting" && (
        <p className="hint">Connecting to Cloudflare…</p>
      )}
      {status.state === "running" && <p>Running.</p>}
      {status.enabled && status.state === "error" && (
        <>
          <p className="error">{status.error}</p>
          <p className="hint">
            Retrying. If it persists, copy the token again from Cloudflare.
          </p>
        </>
      )}
    </div>
  );
}

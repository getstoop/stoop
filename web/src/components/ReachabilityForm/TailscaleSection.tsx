import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";
import type { TailscaleStatus } from "../../gen/stoop/instance/v1/reachability_pb";
import { SettingRow } from "../SettingRow";
import type { Fields, Secrets, SetField, SetSecrets } from "./fields";

// The built-in Tailscale listener: join the tailnet, optionally publish
// the node with Funnel, and read back how the node is doing.
export function TailscaleSection({
  fields,
  set,
  secrets,
  setSecrets,
  customControl,
  setCustomControl,
  data,
}: {
  fields: Fields;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  customControl: boolean;
  setCustomControl: (on: boolean) => void;
  data: GetReachabilityResponse | undefined;
}) {
  return (
    <SettingRow
      className="reach-group reach-tailscale"
      heading
      stack
      title="Tailscale"
      description="Stoop can join your tailnet itself. It will have a real certificate and no port forwarding, reachable only by devices on the tailnet."
    >
      <label className="reach-check">
        <input
          type="checkbox"
          checked={fields.tsEnabled}
          onChange={(e) => set("tsEnabled", e.target.checked)}
        />
        Join my tailnet
      </label>
      {fields.tsEnabled && (
        <>
          <label className="reach-check">
            <input
              type="checkbox"
              checked={fields.tsFunnel}
              onChange={(e) => set("tsFunnel", e.target.checked)}
            />
            Publish this Stoop node to public internet (Funnel)
          </label>
          {fields.tsFunnel && (
            <p className="hint reach-check-hint">
              Tailscale won't actually publish it until the <code>funnel</code>{" "}
              node attribute is in your tailnet policy; until then the node
              stays private and the status below says why.
            </p>
          )}
          <label className="reach-check">
            <input
              type="checkbox"
              checked={customControl}
              onChange={(e) => {
                setCustomControl(e.target.checked);
                // Unticking means "back to Tailscale's own control
                // plane", so the address goes with it — a URL left
                // behind would still be what the node dialled.
                if (!e.target.checked) set("tsControlUrl", "");
              }}
            />
            I run a custom control server
          </label>
          {customControl && (
            <div className="reach-control-url">
              <label>
                Control URL
                <input
                  value={fields.tsControlUrl}
                  onChange={(e) => set("tsControlUrl", e.target.value)}
                  placeholder="https://headscale.example.com"
                  inputMode="url"
                />
              </label>
            </div>
          )}
          <label>
            Node name
            <input
              value={fields.tsHostname}
              onChange={(e) => set("tsHostname", e.target.value)}
              placeholder="stoop"
              autoComplete="off"
            />
            <span className="hint">
              The address becomes https://&lt;name&gt;.&lt;tailnet&gt;.ts.net.
            </span>
          </label>
          <label>
            Auth key
            <input
              type="password"
              value={secrets.tsAuthKey}
              onChange={(e) =>
                setSecrets((s) => ({ ...s, tsAuthKey: e.target.value }))
              }
              placeholder={
                data?.reachability?.tailscale?.hasAuthKey
                  ? "(saved — leave blank to keep)"
                  : "tskey-auth-… — or authorise via the login link"
              }
              autoComplete="off"
            />
          </label>
          {data?.tailscale && (
            <TailscaleStatusBlock
              status={data.tailscale}
              voiceConfigured={data.voiceConfigured}
            />
          )}
        </>
      )}
    </SettingRow>
  );
}

// What the node is doing right now, as the server reports it: waiting
// for authorisation, joining, running (and whether it carries voice), or
// stuck — with the fix for the two errors an admin can't solve here.
function TailscaleStatusBlock({
  status,
  voiceConfigured,
}: {
  status: TailscaleStatus;
  voiceConfigured: boolean;
}) {
  return (
    <div className="reach-ts-status" data-state={status.state}>
      <span className="reach-ts-label">Status:</span>
      {!status.enabled && <p className="hint">Not running.</p>}
      {status.enabled && status.state === "needs_login" && (
        <p>
          Authorise the node:{" "}
          <a href={status.loginUrl} target="_blank" rel="noreferrer">
            {status.loginUrl}
          </a>
        </p>
      )}
      {status.enabled && status.state === "starting" && (
        <p className="hint">Joining the tailnet…</p>
      )}
      {status.state === "running" && (
        <p>
          Running at <code>{status.url}</code>
          {status.funnel ? " (public via Funnel)" : ""}.
        </p>
      )}
      {status.state === "running" && status.carriesVoice && (
        <p className="hint">
          Carrying voice: LiveKit's media ports ride this node at{" "}
          <code>{status.tailnetIp}</code>, so tailnet devices reach them with
          nothing forwarded.
        </p>
      )}
      {status.state === "running" &&
        !status.carriesVoice &&
        voiceConfigured && (
          <p className="hint">
            This node is not carrying voice, so audio won't reach tailnet
            devices through it. Set <code>STOOP_TAILSCALE_VOICE=true</code> and
            restart.
          </p>
        )}
      {status.enabled && status.error && (
        <>
          <p className="error">{status.error}</p>
          <p className="hint">
            {tailscaleFix(status.error).hint}{" "}
            <a
              href={tailscaleFix(status.error).at}
              target="_blank"
              rel="noreferrer"
            >
              Open the Tailscale console
            </a>
            . The server keeps retrying every 30 seconds.
          </p>
        </>
      )}
    </div>
  );
}

// Both of these are fixed in Tailscale's console, not here, so the raw
// tsnet error on its own leaves an admin stuck. Mirrors the branch in
// internal/tailnet/tailnet.go, which logs the same hint server-side.
function tailscaleFix(error: string): { hint: string; at: string } {
  return /funnel/i.test(error)
    ? {
        hint: 'Tailscale is refusing to publish this node: add the "funnel" node attribute to your tailnet policy.',
        at: "https://login.tailscale.com/admin/acls",
      }
    : {
        hint: "If this persists, enable HTTPS certificates for the tailnet.",
        at: "https://login.tailscale.com/admin/dns",
      };
}

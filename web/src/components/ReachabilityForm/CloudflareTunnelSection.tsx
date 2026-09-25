import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";
import { Field } from "../Field";
import { SettingRow } from "../SettingRow";
import { Switch } from "../Switch";
import { CloudflareTunnelStatusBlock } from "./CloudflareTunnelStatusBlock";
import {
  type Fields,
  type ReachErrors,
  type Secrets,
  type SetField,
  type SetSecrets,
  withTunnelProxy,
} from "./fields";

// The Cloudflare Tunnel Stoop runs itself: switch it on, give it the
// tunnel's token, and read back how the connector is doing.
export function CloudflareTunnelSection({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  data,
}: {
  fields: Fields;
  errors: ReachErrors;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  data: GetReachabilityResponse | undefined;
}) {
  const status = data?.cloudflareTunnel;
  // A server that trusts every caller already trusts the connector, and
  // naming one address would replace that with a shorter list. Once the
  // operator names addresses of their own, the connector goes in with
  // them.
  const trustAll =
    (data?.reachability?.trustedProxies?.trustAll ?? false) &&
    fields.proxies.trim() === "";
  return (
    <SettingRow
      className="reach-group reach-tunnel"
      heading
      stack
      title="Cloudflare Tunnel"
      description="A public hostname on your Cloudflare domain, with nothing forwarded from your router. Voice and video can't use the tunnel; they need a relay."
    >
      <label className="reach-check">
        <Switch
          checked={fields.tunnelEnabled}
          onChange={(e) => {
            set("tunnelEnabled", e.target.checked);
            if (!trustAll) {
              set("proxies", withTunnelProxy(fields.proxies, e.target.checked));
            }
          }}
        />
        Run a Cloudflare Tunnel
      </label>
      {status?.state === "missing" && (
        <p className="hint reach-check-hint">
          cloudflared isn't installed on this server.
        </p>
      )}
      {fields.tunnelEnabled && (
        <>
          <Field label="Tunnel token" error={errors["cloudflareTunnel.token"]}>
            <input
              type="password"
              value={secrets.tunnelToken}
              onChange={(e) =>
                setSecrets((s) => ({ ...s, tunnelToken: e.target.value }))
              }
              placeholder={
                data?.reachability?.cloudflareTunnel?.hasToken
                  ? "(saved — leave blank to keep)"
                  : "eyJ…"
              }
              autoComplete="off"
            />
          </Field>
          {status && <CloudflareTunnelStatusBlock status={status} />}
          {status?.state === "running" && fields.publicUrl.trim() === "" && (
            <p className="hint">
              Put the tunnel's hostname in Public address, so invite links use
              it.
            </p>
          )}
        </>
      )}
    </SettingRow>
  );
}

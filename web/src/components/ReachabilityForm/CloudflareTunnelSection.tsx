import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";
import { SettingRow } from "../SettingRow";
import { Switch } from "../Switch";
import {
  type Fields,
  list,
  type ReachErrors,
  type Secrets,
  type SetField,
  type SetSecrets,
  TUNNEL_PROXIES,
  withTunnelProxy,
} from "./fields";
import { TunnelFields } from "./TunnelFields";

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
  const proxies = list(fields.proxies);
  const proxiesAdded =
    fields.tunnelEnabled &&
    TUNNEL_PROXIES.every((proxy) => proxies.includes(proxy));
  return (
    <SettingRow
      className="reach-group reach-tunnel"
      heading
      stack
      title="Cloudflare Tunnel"
      description={`A public hostname on your Cloudflare domain, with nothing forwarded from your router.${data?.voiceOff ? "" : " Voice and video can't use the tunnel; they need a relay."}`}
    >
      <label className="reach-check">
        <Switch
          checked={fields.tunnelEnabled}
          onChange={(e) => {
            set("tunnelEnabled", e.target.checked);
            set("proxies", withTunnelProxy(fields.proxies, e.target.checked));
          }}
        />
        Run a Cloudflare Tunnel
      </label>
      {proxiesAdded && (
        <p className="hint reach-check-hint">
          Added 127.0.0.1 and ::1 to Trusted proxies: cloudflared runs on this
          machine.
        </p>
      )}
      {status?.state === "missing" && (
        <p className="hint reach-check-hint">
          cloudflared isn't installed on this server.
        </p>
      )}
      {fields.tunnelEnabled && (
        <TunnelFields
          fields={fields}
          errors={errors}
          secrets={secrets}
          setSecrets={setSecrets}
          data={data}
        />
      )}
    </SettingRow>
  );
}

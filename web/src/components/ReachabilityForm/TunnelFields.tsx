import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";
import { Field } from "../Field";
import { CloudflareTunnelStatusBlock } from "./CloudflareTunnelStatusBlock";
import type { Fields, ReachErrors, Secrets, SetSecrets } from "./fields";

// The token and how the tunnel is doing. Setup shows it on its own.
export function TunnelFields({
  fields,
  errors,
  secrets,
  setSecrets,
  data,
}: {
  fields: Fields;
  errors: ReachErrors;
  secrets: Secrets;
  setSecrets: SetSecrets;
  data: GetReachabilityResponse | undefined;
}) {
  const status = data?.cloudflareTunnel;
  return (
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
          Put the tunnel's hostname in Public address, so invite links use it.
        </p>
      )}
    </>
  );
}

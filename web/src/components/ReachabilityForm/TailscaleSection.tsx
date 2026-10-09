import type { GetReachabilityResponse } from "../../gen/stoop/instance/v1/instance_pb";
import { SettingRow } from "../SettingRow";
import { Switch } from "../Switch";
import type {
  Fields,
  ReachErrors,
  Secrets,
  SetField,
  SetSecrets,
} from "./fields";
import { TailscaleFields } from "./TailscaleFields";

// The built-in Tailscale listener: join the tailnet, optionally publish
// the node with Funnel, and read back how the node is doing.
export function TailscaleSection({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  customControl,
  setCustomControl,
  data,
}: {
  fields: Fields;
  errors: ReachErrors;
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
        <Switch
          checked={fields.tsEnabled}
          onChange={(e) => set("tsEnabled", e.target.checked)}
        />
        Join my tailnet
      </label>
      {fields.tsEnabled && (
        <TailscaleFields
          fields={fields}
          errors={errors}
          set={set}
          secrets={secrets}
          setSecrets={setSecrets}
          customControl={customControl}
          setCustomControl={setCustomControl}
          data={data}
        />
      )}
    </SettingRow>
  );
}

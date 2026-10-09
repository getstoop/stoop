import type { Reachability } from "../../gen/stoop/instance/v1/reachability_pb";
import { SettingRow } from "../SettingRow";
import { Switch } from "../Switch";
import { CloudflareRelayFields } from "./CloudflareRelayFields";
import {
  clearCloudflareRelay,
  clearOwnRelay,
  type Fields,
  type ReachErrors,
  type Secrets,
  type SetField,
  type SetSecrets,
} from "./fields";
import { OwnRelayFields } from "./OwnRelayFields";

// Carries voice audio for browsers that can't reach LiveKit's media ports
// directly. Two ways to answer the same question, so they share a
// section: Cloudflare's relay, and one you run yourself. Both can be on.
export function VoiceRelaySection({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  showOwnRelay,
  setShowOwnRelay,
  saved,
}: {
  fields: Fields;
  errors: ReachErrors;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  // "A TURN relay I run myself" is a checkbox with no field of its own;
  // the form owns it because seeding decides it from the saved URLs.
  showOwnRelay: boolean;
  setShowOwnRelay: (on: boolean) => void;
  // What the server has, for the "(saved — leave blank to keep)" hints.
  saved: Reachability | undefined;
}) {
  return (
    <SettingRow
      className="reach-group reach-voice-relay"
      heading
      stack
      title="Voice relay"
      description="Carries voice audio for browsers that can't reach LiveKit's media ports directly. Either of these will do, and both can be on at once."
    >
      <CloudflareRelay
        fields={fields}
        errors={errors}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        hasApiToken={saved?.cloudflare?.hasApiToken ?? false}
      />
      <OwnRelay
        fields={fields}
        errors={errors}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        show={showOwnRelay}
        setShow={setShowOwnRelay}
        hasCredential={saved?.turn?.hasCredential ?? false}
      />
    </SettingRow>
  );
}

function CloudflareRelay({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  hasApiToken,
}: {
  fields: Fields;
  errors: ReachErrors;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  hasApiToken: boolean;
}) {
  return (
    <div className="reach-cloudflare">
      <label className="reach-check">
        <Switch
          checked={fields.cloudflareTurnEnabled}
          onChange={(e) => {
            set("cloudflareTurnEnabled", e.target.checked);
            if (!e.target.checked) clearCloudflareRelay(set, setSecrets);
          }}
        />
        Cloudflare's TURN relay
      </label>
      {fields.cloudflareTurnEnabled && (
        <CloudflareRelayFields
          fields={fields}
          errors={errors}
          set={set}
          secrets={secrets}
          setSecrets={setSecrets}
          hasApiToken={hasApiToken}
        />
      )}
    </div>
  );
}

function OwnRelay({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  show,
  setShow,
  hasCredential,
}: {
  fields: Fields;
  errors: ReachErrors;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  show: boolean;
  setShow: (on: boolean) => void;
  hasCredential: boolean;
}) {
  return (
    <div className="reach-own-relay">
      <label className="reach-check">
        <Switch
          checked={show}
          onChange={(e) => {
            setShow(e.target.checked);
            if (!e.target.checked) clearOwnRelay(set, setSecrets);
          }}
        />
        A TURN relay I run myself
      </label>
      {show && (
        <OwnRelayFields
          fields={fields}
          errors={errors}
          set={set}
          secrets={secrets}
          setSecrets={setSecrets}
          hasCredential={hasCredential}
        />
      )}
    </div>
  );
}

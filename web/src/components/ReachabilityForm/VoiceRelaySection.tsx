import type { Reachability } from "../../gen/stoop/instance/v1/reachability_pb";
import { Field } from "../Field";
import { LearnMore } from "../LearnMore";
import { SettingRow } from "../SettingRow";
import type {
  Fields,
  ReachErrors,
  Secrets,
  SetField,
  SetSecrets,
} from "./fields";

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
        <input
          type="checkbox"
          checked={fields.cloudflareTurnEnabled}
          onChange={(e) => {
            set("cloudflareTurnEnabled", e.target.checked);
            // Unticking means "not using Cloudflare's relay", so the key
            // goes with it — one left behind would still be saved, and
            // the relay still live.
            if (!e.target.checked) {
              set("cfKey", "");
              setSecrets((s) => ({ ...s, cfToken: "" }));
            }
          }}
        />
        Cloudflare's TURN relay
      </label>
      {fields.cloudflareTurnEnabled && (
        <>
          <div className="reach-relay">
            <Field label="Key id" error={errors["cloudflare.keyId"]}>
              <input
                value={fields.cfKey}
                onChange={(e) => set("cfKey", e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="API token" error={errors["cloudflare.apiToken"]}>
              <input
                type="password"
                value={secrets.cfToken}
                onChange={(e) =>
                  setSecrets((s) => ({ ...s, cfToken: e.target.value }))
                }
                placeholder={hasApiToken ? "(saved — leave blank to keep)" : ""}
                autoComplete="off"
              />
            </Field>
          </div>
          <LearnMore>
            <p className="hint">
              Cloudflare dashboard → Realtime → TURN mints the pair; the free
              tier carries 1 TB a month. Stoop signs its own short-lived
              credentials from the key, so the token never reaches a browser.
            </p>
          </LearnMore>
        </>
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
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => {
            setShow(e.target.checked);
            // Unticking means "no relay of my own", so the addresses go
            // with it — ones left behind would still be what a browser
            // was handed for voice.
            if (!e.target.checked) {
              set("turnUrls", "");
              set("stunUrls", "");
              set("turnUser", "");
              setSecrets((s) => ({ ...s, turnCred: "" }));
            }
          }}
        />
        A TURN relay I run myself
      </label>
      {show && (
        <>
          <Field
            label="TURN URLs (comma-separated)"
            error={errors["turn.urls"]}
          >
            <input
              value={fields.turnUrls}
              onChange={(e) => set("turnUrls", e.target.value)}
              placeholder="turns:turn.example.com:5349, turn:turn.example.com:3478?transport=udp"
            />
          </Field>
          <Field label="STUN URLs" error={errors["turn.stunUrls"]}>
            <input
              value={fields.stunUrls}
              onChange={(e) => set("stunUrls", e.target.value)}
              placeholder="stun:turn.example.com:3478"
            />
          </Field>
          <Field label="Username" error={errors["turn.username"]}>
            <input
              value={fields.turnUser}
              onChange={(e) => set("turnUser", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Credential" error={errors["turn.credential"]}>
            <input
              type="password"
              value={secrets.turnCred}
              onChange={(e) =>
                setSecrets((s) => ({ ...s, turnCred: e.target.value }))
              }
              placeholder={hasCredential ? "(saved — leave blank to keep)" : ""}
              autoComplete="off"
            />
          </Field>
        </>
      )}
    </div>
  );
}

import { Field } from "../Field";
import { LearnMore } from "../LearnMore";
import type {
  Fields,
  ReachErrors,
  Secrets,
  SetField,
  SetSecrets,
} from "./fields";

// Cloudflare's relay key and token. Setup shows it on its own.
export function CloudflareRelayFields({
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
          Cloudflare dashboard → Realtime → TURN mints the pair; the free tier
          carries 1 TB a month. Stoop signs its own short-lived credentials from
          the key, so the token never reaches a browser.
        </p>
      </LearnMore>
    </>
  );
}

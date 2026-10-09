import { Field } from "../Field";
import type {
  Fields,
  ReachErrors,
  Secrets,
  SetField,
  SetSecrets,
} from "./fields";

// The relay you run: its addresses and credential. Setup shows it on its
// own.
export function OwnRelayFields({
  fields,
  errors,
  set,
  secrets,
  setSecrets,
  hasCredential,
}: {
  fields: Fields;
  errors: ReachErrors;
  set: SetField;
  secrets: Secrets;
  setSecrets: SetSecrets;
  hasCredential: boolean;
}) {
  return (
    <>
      <Field label="TURN URLs (comma-separated)" error={errors["turn.urls"]}>
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
  );
}

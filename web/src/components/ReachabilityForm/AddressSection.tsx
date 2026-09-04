import { SettingRow } from "../SettingRow";
import type { Fields, SetField } from "./fields";

// How requests arrive: the address people use, and whatever forwards
// them here.
export function AddressSection({
  fields,
  set,
  trustAll,
}: {
  fields: Fields;
  set: SetField;
  // Whether the server is currently trusting every caller's forwarded
  // headers (STOOP_TRUST_PROXY=true), which naming proxies replaces.
  trustAll: boolean;
}) {
  return (
    <>
      <SettingRow
        id="reach-public-url"
        className="reach-group reach-address"
        title="Public address"
        description="The address people use to reach this Stoop server. Invite links are built from it. Leave it blank to use whatever address the person copying a link happens to be on."
      >
        <input
          id="reach-public-url"
          value={fields.publicUrl}
          onChange={(e) => set("publicUrl", e.target.value)}
          placeholder="https://chat.example.com"
          inputMode="url"
        />
      </SettingRow>

      <SettingRow
        id="reach-proxies"
        className="reach-group reach-proxies"
        title="Trusted proxies"
        description={
          <>
            Whatever forwards requests to this server, by address or CIDR range.
            Blank if nothing sits in front. <strong>Do not</strong> name an
            address that isn't really your proxy: that address can then slip the
            sign-in rate limit. Changes apply immediately — no restart.
          </>
        }
      >
        <input
          id="reach-proxies"
          value={fields.proxies}
          onChange={(e) => set("proxies", e.target.value)}
          placeholder="10.0.0.0/8, 192.168.1.5"
          autoComplete="off"
        />
        {/* The warning about a wide-open trust setting isn't help text —
            it's about this server right now, so it stays in the open. */}
        {trustAll && (
          <p className="hint">
            This server currently trusts <strong>every</strong> caller's
            forwarded headers (STOOP_TRUST_PROXY=true in its environment).
            Naming addresses here replaces that with something safer.
          </p>
        )}
      </SettingRow>
    </>
  );
}

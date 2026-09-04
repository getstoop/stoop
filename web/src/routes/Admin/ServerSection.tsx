import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import {
  RegistrationPolicy,
  SpaceCreationPolicy,
} from "../../gen/stoop/instance/v1/instance_pb";

const MAX_NAME_LENGTH = 100;

const POLICIES: { value: RegistrationPolicy; label: string; hint: string }[] = [
  {
    value: RegistrationPolicy.INVITE,
    label: "Invite only",
    hint: "New accounts need a space invite code. Recommended.",
  },
  {
    value: RegistrationPolicy.OPEN,
    label: "Open",
    hint: "Anyone who can reach this server can create an account.",
  },
  {
    value: RegistrationPolicy.CLOSED,
    label: "Closed",
    hint: "Only server admins can create accounts.",
  },
];

const SPACE_CREATION: {
  value: SpaceCreationPolicy;
  label: string;
  hint: string;
}[] = [
  {
    value: SpaceCreationPolicy.ADMINS,
    label: "Server admins only",
    hint: "Members join spaces by invite; admins create them.",
  },
  {
    value: SpaceCreationPolicy.EVERYONE,
    label: "Everyone",
    hint: "Any account can create its own spaces.",
  },
];

// The Server group: name, who can create an account, who can create
// spaces. One form, one Save — three settings changed by three different
// controls (a text field, two selects) would otherwise apply the moment
// you touch them, so a stray click on a select silently flips a policy.
// Requiring Save is also what lets the three travel to the server as one
// UpdateSettings call instead of three round trips.
export function ServerSection() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<RegistrationPolicy | null>(
    null,
  );
  const [spaceDraft, setSpaceDraft] = useState<SpaceCreationPolicy | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownName = nameDraft ?? status?.instanceName ?? "";
  const shownPolicy =
    policyDraft ?? status?.registrationPolicy ?? RegistrationPolicy.INVITE;
  const shownSpace =
    spaceDraft ?? status?.spaceCreation ?? SpaceCreationPolicy.ADMINS;
  const changed =
    (nameDraft !== null && nameDraft.trim() !== status?.instanceName) ||
    (policyDraft !== null && policyDraft !== status?.registrationPolicy) ||
    (spaceDraft !== null && spaceDraft !== status?.spaceCreation);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const name = shownName.trim();
    if (nameDraft !== null && !name) {
      setError("Enter a server name.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await instanceClient.updateSettings({
        ...(nameDraft !== null && { instanceName: name }),
        ...(policyDraft !== null && { registrationPolicy: policyDraft }),
        ...(spaceDraft !== null && { spaceCreation: spaceDraft }),
      });
      setNameDraft(null);
      setPolicyDraft(null);
      setSpaceDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={save}>
      <SettingRow
        id="instance-name"
        title="Server name"
        description="Shown in the browser tab. Starts out random so instances aren't all named the same."
      >
        <input
          id="instance-name"
          value={shownName}
          maxLength={MAX_NAME_LENGTH}
          disabled={busy || !status}
          onChange={(e) => setNameDraft(e.target.value)}
        />
      </SettingRow>
      <SettingRow
        id="registration-policy"
        title="Who can create an account"
        description={POLICIES.find((p) => p.value === shownPolicy)?.hint}
      >
        <select
          id="registration-policy"
          name="registration-policy"
          value={shownPolicy}
          disabled={busy || !status}
          onChange={(e) =>
            setPolicyDraft(Number(e.target.value) as RegistrationPolicy)
          }
        >
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        id="space-creation"
        title="Who can create spaces"
        description={SPACE_CREATION.find((p) => p.value === shownSpace)?.hint}
      >
        <select
          id="space-creation"
          name="space-creation"
          value={shownSpace}
          disabled={busy || !status}
          onChange={(e) =>
            setSpaceDraft(Number(e.target.value) as SpaceCreationPolicy)
          }
        >
          {SPACE_CREATION.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </SettingRow>
      {error && <p className="error">{error}</p>}
      <div className="setting-actions">
        <button type="submit" className="primary" disabled={busy || !changed}>
          Save changes
        </button>
        {saved && !changed && <span className="hint">Saved.</span>}
      </div>
    </form>
  );
}

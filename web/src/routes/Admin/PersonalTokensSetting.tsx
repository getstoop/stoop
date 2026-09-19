import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import { PersonalTokens } from "../../gen/stoop/instance/v1/instance_pb";

const OPTIONS: { value: PersonalTokens; label: string; hint: string }[] = [
  {
    value: PersonalTokens.EVERYONE,
    label: "Everyone",
    hint: "Anyone may make tokens for their own scripts, from Profile → Security.",
  },
  {
    value: PersonalTokens.ADMINS,
    label: "Server admins only",
    hint: "Members can't make tokens, and the ones they have stop working until this goes back to Everyone.",
  },
  {
    value: PersonalTokens.OFF,
    label: "Off",
    hint: "Nobody can make a token and none work. They're kept, and work again if you turn this back on.",
  },
];

// Who may make and use personal tokens. On the Accounts tab, above the
// list whose token counts it governs.
export function PersonalTokensSetting() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = status?.personalTokens ?? PersonalTokens.EVERYONE;

  const set = async (value: PersonalTokens) => {
    setBusy(true);
    setError(null);
    try {
      await instanceClient.updateSettings({ personalTokens: value });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      await queryClient.invalidateQueries({ queryKey: ["user-tokens"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <SettingRow
        id="personal-tokens"
        title="Personal tokens"
        description={OPTIONS.find((o) => o.value === current)?.hint}
      >
        <select
          id="personal-tokens"
          name="personal-tokens"
          value={current}
          disabled={busy || !status}
          onChange={(e) => set(Number(e.target.value) as PersonalTokens)}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </SettingRow>
    </section>
  );
}

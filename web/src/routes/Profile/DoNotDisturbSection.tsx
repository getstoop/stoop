import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api/errors";
import { dndActive, setDoNotDisturb } from "../../api/presence";
import { useMe } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import { notice } from "../../stores/dialogs";

// Do not disturb belongs to the account: turned on here, it holds alerts on
// every device signed in, and everyone else sees it on the dot.
export function DoNotDisturbSection() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [saving, setSaving] = useState(false);
  const on = dndActive(me);

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      await setDoNotDisturb(queryClient, next);
    } catch (err) {
      notice({ title: "Couldn't change do not disturb", body: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      className="dnd-section"
      title="Do not disturb"
      description="Holds desktop alerts on every device you're signed in on, and shows everyone else you'd rather not be disturbed."
    >
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={on}
          disabled={!me || saving}
          onChange={(e) => change(e.target.checked)}
        />
        {on ? "On" : "Off"}
      </label>
    </SettingRow>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";

// Whether people may delete their own accounts. On the Accounts tab,
// beside the token setting, above the list it applies to.
export function SelfDeletionSetting() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await instanceClient.updateSettings({ selfDeletion: on });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <SettingRow
        id="self-deletion"
        title="People can delete their own accounts"
        description="Their messages stay under their name, marked deleted; everything else that was theirs goes. Off, the account page says to ask an admin."
        error={error}
      >
        <input
          id="self-deletion"
          type="checkbox"
          checked={status?.selfDeletion ?? true}
          disabled={busy || !status}
          onChange={(e) => set(e.target.checked)}
        />
      </SettingRow>
    </section>
  );
}

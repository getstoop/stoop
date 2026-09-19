import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";

// How long a sign-in lasts. On the Login tab, beside the ways in.
export function SessionLifetimeSetting() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [days, setDays] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = days ?? (status ? String(status.sessionLifetimeDays) : "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(shown);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      setError("Enter a number of days between 1 and 365.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await instanceClient.updateSettings({ sessionLifetimeDays: n });
      setDays(null);
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
        id="session-lifetime"
        title="Stay signed in for"
        description="How long a sign-in lasts before asking again, 1 to 365 days. Applies to sign-ins from now on; nobody is signed out by changing it."
      >
        <input
          id="session-lifetime"
          type="number"
          min="1"
          max="365"
          step="1"
          value={shown}
          disabled={busy || !status}
          onChange={(e) => setDays(e.target.value)}
        />
        <span className="muted small">days</span>
      </SettingRow>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="setting-actions">
        <button
          type="submit"
          className="primary"
          disabled={busy || days === null}
        >
          Save changes
        </button>
        {saved && days === null && <span className="hint">Saved.</span>}
      </div>
    </form>
  );
}

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { filesClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { SettingRow } from "../../components/SettingRow";

// The sweep, on demand. The server runs the same pass on a schedule; this
// queues one now and the Diagnostics tab shows it run. One row of the
// Storage group.
export function CleanupSection() {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = async () => {
    setBusy(true);
    setError(null);
    try {
      await filesClient.sweepFiles({});
      setQueued(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      className="cleanup-section"
      title="Clean up disk"
      description="Uploads nothing points at any more are deleted automatically once they are a day old. This queues that pass now."
    >
      <button
        type="button"
        className="chip sweep-button"
        disabled={busy}
        onClick={clean}
      >
        Clean now
      </button>
      {queued && (
        <p className="muted small">
          Cleaning up in the background. Progress is under{" "}
          <Link to="/admin" search={{ tab: "diagnostics" }}>
            Diagnostics → Background work
          </Link>
          .
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </SettingRow>
  );
}

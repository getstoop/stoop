import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { filesClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { SettingRow } from "../../components/SettingRow";

// The sweep, on demand. The server runs the same pass on a schedule; this
// queues one now and the Diagnostics tab shows it run. One row of the
// Storage group.

// The usage numbers lag the queued sweep, so they are refreshed for a while.
const USAGE_REFRESH_MS = 5000;
const USAGE_REFRESH_FOR_MS = 60_000;

export function CleanupSection() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = async () => {
    setBusy(true);
    setQueued(false);
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

  useEffect(() => {
    if (!queued) return;
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["storage-usage"] });
    const timer = setInterval(refresh, USAGE_REFRESH_MS);
    const stop = setTimeout(() => clearInterval(timer), USAGE_REFRESH_FOR_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [queued, queryClient]);

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

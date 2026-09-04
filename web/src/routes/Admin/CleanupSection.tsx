import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { filesClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { SettingRow } from "../../components/SettingRow";
import { formatBytes } from "./bytes";

// The sweep, on demand. The server runs the same pass every few hours;
// this is the button for when the disk needs the space now. One row of
// the Storage group.
export function CleanupSection() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clean = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await filesClient.sweepFiles({});
      const parts = [
        `${r.filesRemoved} file${r.filesRemoved === 1n ? "" : "s"} (${formatBytes(r.bytesFreed)})`,
      ];
      if (r.strayBlobsRemoved > 0n)
        parts.push(
          `${r.strayBlobsRemoved} stray blob${r.strayBlobsRemoved === 1n ? "" : "s"}`,
        );
      setNote(
        `Removed ${parts.join(" and ")}${r.errors > 0n ? `; ${r.errors} could not be removed (see the server log)` : "."}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["storage-usage"] });
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
      description="Uploads nothing points at any more are deleted automatically once they are a day old. This runs that pass now."
    >
      <button
        type="button"
        className="chip sweep-button"
        disabled={busy}
        onClick={clean}
      >
        Clean now
      </button>
      {note && <p className="muted small">{note}</p>}
      {error && <p className="error">{error}</p>}
    </SettingRow>
  );
}

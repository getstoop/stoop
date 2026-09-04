import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { filesClient, instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { MAX_ATTACHMENT_BYTES } from "../../api/files";
import { useInstanceStatus } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import { formatBytes, GB } from "./bytes";

const MB = 1024 * 1024;
// The server's own ceiling on one file; the setting can only come down
// from it — see "File storage" in docs/self-hosting.md.
const CEILING_MB = MAX_ATTACHMENT_BYTES / MB;

// The two limits on uploads, saved together: the cap on total storage
// (past it uploads are refused; nothing is deleted — that is
// CleanupSection) and the cap on one file, without which a single file
// can take the whole quota. See "Upload storage" in docs/self-hosting.md.
export function StorageSection() {
  const queryClient = useQueryClient();
  const { data: status, error: statusError } = useInstanceStatus();
  const { data: usage, error: usageError } = useQuery({
    queryKey: ["storage-usage"],
    queryFn: async () => filesClient.getStorageUsage({}),
  });
  const [limitGb, setLimitGb] = useState<string | null>(null);
  const [limitMb, setLimitMb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownGb =
    limitGb ?? (usage ? String(Number(usage.quotaBytes) / GB) : "");
  const shownMb =
    limitMb ?? (status ? String(Number(status.maxUploadBytes) / MB) : "");
  const changed = limitGb !== null || limitMb !== null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const gb = Number(shownGb);
    const mb = Number(shownMb);
    if (!Number.isFinite(gb) || gb < 0) {
      setError("Enter a storage limit in GB, or 0 for no limit.");
      return;
    }
    if (!Number.isFinite(mb) || mb <= 0 || mb > CEILING_MB) {
      setError(`Enter a size per file in MB, between 1 and ${CEILING_MB}.`);
      return;
    }
    // A per-file cap above the whole disk allowance is a limit that can
    // never be reached. The server refuses it too; this only answers
    // before the round trip.
    if (gb > 0 && mb * MB > gb * GB) {
      setError(
        "The size per file is more than the storage limit. Raise the limit, or pick a smaller size.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await instanceClient.updateSettings({
        storageQuotaBytes: BigInt(Math.round(gb * GB)),
        maxUploadBytes: BigInt(Math.round(mb * MB)),
      });
      setLimitGb(null);
      setLimitMb(null);
      await queryClient.invalidateQueries({ queryKey: ["storage-usage"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="storage-section" onSubmit={save}>
      <SettingRow
        id="storage-quota"
        className="storage-quota"
        title="Upload storage limit"
        description={
          <>
            {usage
              ? `${formatBytes(usage.usedBytes)} in ${usage.fileCount} file${usage.fileCount === 1n ? "" : "s"}` +
                (usage.quotaBytes > 0n
                  ? ` · limit ${formatBytes(usage.quotaBytes)} · ${formatBytes(
                      usage.quotaBytes > usage.usedBytes
                        ? usage.quotaBytes - usage.usedBytes
                        : 0n,
                    )} left.`
                  : " · no limit.")
              : usageError
                ? errorText(usageError)
                : "Loading…"}{" "}
            Uploads are refused once the total passes the limit. Avatars, space
            icons and every attachment count towards it. 0 is no limit.
          </>
        }
      >
        {usage && usage.quotaBytes > 0n && (
          <StorageBar used={usage.usedBytes} limit={usage.quotaBytes} />
        )}
        <input
          id="storage-quota"
          type="number"
          min="0"
          step="0.5"
          value={shownGb}
          disabled={busy || !usage}
          onChange={(e) => setLimitGb(e.target.value)}
        />
        <span className="muted small">GB</span>
      </SettingRow>
      <SettingRow
        id="max-upload"
        className="upload-limit"
        title="Maximum size per file"
        description={
          <>
            {status
              ? `Each file may be up to ${Number(status.maxUploadBytes) / MB} MB.`
              : statusError
                ? errorText(statusError)
                : "Loading…"}{" "}
            The most one attachment can be, at most {CEILING_MB} MB.
          </>
        }
      >
        <input
          id="max-upload"
          type="number"
          min="1"
          max={CEILING_MB}
          step="1"
          value={shownMb}
          disabled={busy || !status}
          onChange={(e) => setLimitMb(e.target.value)}
        />
        <span className="muted small">MB</span>
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

// How full the disk is against the limit. A fraction needs something to
// be a fraction of, so with no limit set there is no bar at all.
function StorageBar({ used, limit }: { used: bigint; limit: bigint }) {
  const pct = Math.min(100, (Number(used) / Number(limit)) * 100);
  const state = pct >= 100 ? "full" : pct >= 80 ? "warn" : "";
  return (
    <div
      className={`storage-bar ${state}`}
      role="progressbar"
      aria-label="Upload storage used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${Math.round(pct)}% of ${formatBytes(limit)} used`}
    >
      <div className="storage-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

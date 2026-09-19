import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";
import {
  attachmentRetentionMoot,
  retentionConfirmBody,
  shortens,
} from "../../api/retention";
import { SettingRow } from "../../components/SettingRow";
import { confirm } from "../../stores/dialogs";
import { formatBytes } from "./bytes";

const MAX_DAYS = 3650;

// How long messages and attachments are kept, on the Storage tab. Blank
// keeps forever. A shorter period asks first, with what it would delete
// now. See "Retention" in docs/self-hosting.md.
export function RetentionSection() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [messages, setMessages] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = (draft: string | null, days: number | undefined) =>
    draft ?? (days ? String(days) : "");
  const shownMessages = shown(messages, status?.messageRetentionDays);
  const shownAttachments = shown(attachments, status?.attachmentRetentionDays);
  const changed = messages !== null || attachments !== null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!status) return;
    const m = Number(shownMessages || 0);
    const a = Number(shownAttachments || 0);
    for (const n of [m, a]) {
      if (!Number.isInteger(n) || n < 0 || n > MAX_DAYS) {
        setError(
          `Enter a number of days between 1 and ${MAX_DAYS}, or leave it blank to keep forever.`,
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (
        shortens(status.messageRetentionDays, m) ||
        shortens(status.attachmentRetentionDays, a)
      ) {
        const preview = await instanceClient.previewRetention({
          messageRetentionDays: m,
          attachmentRetentionDays: a,
        });
        const ok = await confirm({
          title: "Delete older messages and files?",
          body: retentionConfirmBody(
            preview,
            m,
            a,
            formatBytes(preview.attachmentBytes),
          ),
          action: "Delete and save",
          danger: true,
        });
        if (!ok) return;
      }
      await instanceClient.updateSettings({
        messageRetentionDays: m,
        attachmentRetentionDays: a,
      });
      setMessages(null);
      setAttachments(null);
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      await queryClient.invalidateQueries({ queryKey: ["storage-usage"] });
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="retention-section" onSubmit={save}>
      <SettingRow
        id="message-retention"
        title="Delete messages after"
        description="Messages older than this are deleted everywhere, direct messages included, with their files. Pinned messages are kept. Blank keeps messages forever."
      >
        <input
          id="message-retention"
          type="number"
          min="1"
          max={MAX_DAYS}
          step="1"
          placeholder="Forever"
          value={shownMessages}
          disabled={busy || !status}
          onChange={(e) => setMessages(e.target.value)}
        />
        <span className="muted small">days</span>
      </SettingRow>
      <SettingRow
        id="attachment-retention"
        title="Delete attachments after"
        description={
          <>
            Files older than this are deleted with their names; the message
            stays and shows “Expired attachment”. Avatars, icons and pinned
            messages' files are kept. Blank keeps files forever.
            {attachmentRetentionMoot(
              Number(shownMessages || 0),
              Number(shownAttachments || 0),
            ) && (
              <span className="hint">
                {" "}
                Messages are deleted first, so this won't take effect.
              </span>
            )}
          </>
        }
      >
        <input
          id="attachment-retention"
          type="number"
          min="1"
          max={MAX_DAYS}
          step="1"
          placeholder="Forever"
          value={shownAttachments}
          disabled={busy || !status}
          onChange={(e) => setAttachments(e.target.value)}
        />
        <span className="muted small">days</span>
      </SettingRow>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="setting-actions">
        <button type="submit" className="primary" disabled={busy || !changed}>
          Save changes
        </button>
        {saved && !changed && <span className="hint">Saved.</span>}
      </div>
    </form>
  );
}

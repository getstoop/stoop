import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { instanceClient } from "../../api/clients";
import { useInstanceStatus } from "../../api/queries";
import { NumberInput } from "../../components/NumberInput";
import { SettingRow } from "../../components/SettingRow";
import { useFieldErrors } from "../../hooks/useFieldErrors";

const MAX_MB = 16;

// How much of a linked page a preview reads. On the Server tab.
export function LinkPreviewSetting() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [megabytes, setMegabytes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const form = useFieldErrors(["linkPreviewHtmlMb"]);
  const shown = megabytes ?? (status ? String(status.linkPreviewHtmlMb) : "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(shown);
    form.begin();
    if (!Number.isInteger(n) || n < 1 || n > MAX_MB) {
      form.set("linkPreviewHtmlMb", `Enter a size between 1 and ${MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    setSaved(false);
    try {
      await instanceClient.updateSettings({ linkPreviewHtmlMb: n });
      setMegabytes(null);
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      setSaved(true);
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" ref={form.formRef} onSubmit={save}>
      <SettingRow
        id="link-preview-html"
        title="Link preview page size"
        description={`How much of a linked page is read to find its title and image, 1 to ${MAX_MB} MB.`}
        error={form.errors.linkPreviewHtmlMb}
      >
        <NumberInput
          id="link-preview-html"
          unit="MB"
          min="1"
          max={MAX_MB}
          step="1"
          value={shown}
          disabled={busy || !status}
          onChange={(e) => setMegabytes(e.target.value)}
        />
      </SettingRow>
      <div className="setting-actions">
        <button
          type="submit"
          className="primary"
          disabled={busy || megabytes === null}
        >
          Save changes
        </button>
        {saved && megabytes === null && <span className="hint">Saved.</span>}
      </div>
    </form>
  );
}

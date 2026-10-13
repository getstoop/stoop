import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { instanceClient } from "../../api/clients";
import { useInstanceStatus, useReachability } from "../../api/queries";
import { Input } from "../../components/Input";
import { NumberInput } from "../../components/NumberInput";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";
import { useFieldErrors } from "../../hooks/useFieldErrors";

const MAX_MB = 16;

// Whether links get previews, how much of a linked page one reads, and
// the proxy the fetches go through. The Link previews tab. One form, one
// Save: nothing applies until it is pressed, and everything travels as
// one UpdateSettings call. The proxy is read with the Hosting settings,
// which only an admin may read.
export function LinkPreviewSetting() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const { data: reachability } = useReachability(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [megabytes, setMegabytes] = useState<string | null>(null);
  const [proxy, setProxy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const form = useFieldErrors([
    "linkPreviews",
    "linkPreviewHtmlMb",
    "linkPreviewProxy",
  ]);
  const shownEnabled = enabled ?? status?.linkPreviews ?? false;
  const shown = megabytes ?? (status ? String(status.linkPreviewHtmlMb) : "");
  const shownProxy = proxy ?? reachability?.linkPreviewProxy ?? "";
  const changed =
    (enabled !== null && enabled !== status?.linkPreviews) ||
    megabytes !== null ||
    proxy !== null;

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
      await instanceClient.updateSettings({
        linkPreviews: shownEnabled,
        linkPreviewHtmlMb: n,
        linkPreviewProxy: proxy === null ? undefined : proxy.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      await queryClient.invalidateQueries({ queryKey: ["reachability"] });
      setEnabled(null);
      setMegabytes(null);
      setProxy(null);
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
        id="link-previews"
        title="Link previews"
        description="Links in messages get a card with the page's title and image. The server fetches the page, never the reader's browser."
        error={form.errors.linkPreviews}
      >
        <Switch
          id="link-previews"
          checked={shownEnabled}
          disabled={busy || !status}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </SettingRow>
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
      <SettingRow
        id="link-preview-proxy"
        title="Link preview proxy"
        description="A SOCKS5 proxy the fetches go through, so linked sites see its address and not this server's."
        error={form.errors.linkPreviewProxy}
      >
        <Input
          id="link-preview-proxy"
          placeholder="socks5://host:port"
          autoComplete="off"
          spellCheck={false}
          value={shownProxy}
          disabled={busy || !reachability}
          onChange={(e) => setProxy(e.target.value)}
        />
      </SettingRow>
      <div className="setting-actions">
        <button type="submit" className="primary" disabled={busy || !changed}>
          Save changes
        </button>
        {saved && !changed && <span className="hint">Saved.</span>}
      </div>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
    </form>
  );
}

import { type FormEvent, useState } from "react";
import { AddressSection } from "./AddressSection";
import { CloudflareTunnelSection } from "./CloudflareTunnelSection";
import { list } from "./fields";
import { LiveKitSection } from "./LiveKitSection";
import { TailscaleSection } from "./TailscaleSection";
import { useReachabilityDraft } from "./useReachabilityDraft";
import { VoiceRelaySection } from "./VoiceRelaySection";
import { voiceStatus } from "./voiceStatus";

export function ReachabilityForm({
  onSaved,
  onSkip,
}: {
  onSaved?: () => void;
  // When given, a "Skip for now" button appears (the wizard).
  onSkip?: () => void;
}) {
  const [showOwnRelay, setShowOwnRelay] = useState(false);
  const [customControl, setCustomControl] = useState(false);
  const {
    data,
    isLoading,
    fields,
    set,
    secrets,
    setSecrets,
    form,
    dirty,
    busy,
    save,
  } = useReachabilityDraft((next) => {
    if (list(next.turnUrls).length > 0) setShowOwnRelay(true);
    setCustomControl(next.tsControlUrl !== "");
  });
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (await save()) {
      setSaved(true);
      onSaved?.();
    }
  };

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <form className="reach-form" ref={form.formRef} onSubmit={submit}>
      <AddressSection fields={fields} errors={form.errors} set={set} />

      <CloudflareTunnelSection
        fields={fields}
        errors={form.errors}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        data={data}
      />

      <TailscaleSection
        fields={fields}
        errors={form.errors}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        customControl={customControl}
        setCustomControl={setCustomControl}
        data={data}
      />

      {!data?.voiceOff && (
        <>
          <LiveKitSection lk={data?.livekit} />

          <VoiceRelaySection
            fields={fields}
            errors={form.errors}
            set={set}
            secrets={secrets}
            setSecrets={setSecrets}
            showOwnRelay={showOwnRelay}
            setShowOwnRelay={setShowOwnRelay}
            saved={data?.reachability}
          />
        </>
      )}

      {/* What the settings above add up to, rather than what anyone
          intended: read back from the server after every save. */}
      <p className="reach-voice" data-voice={data?.voiceConfigured ?? false}>
        {voiceStatus(data)}
      </p>

      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      {saved && !dirty && <p className="hint reach-saved">Saved.</p>}
      <div className="reach-actions">
        <button
          type="submit"
          className="primary reach-save"
          disabled={busy || !dirty}
        >
          Save changes
        </button>
        {onSkip && (
          <button
            type="button"
            className="chip reach-continue"
            onClick={onSkip}
            disabled={busy}
          >
            {saved ? "Continue" : "Skip for now"}
          </button>
        )}
      </div>
    </form>
  );
}

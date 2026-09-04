import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useReachability } from "../../api/queries";
import { AddressSection } from "./AddressSection";
import {
  changesFrom,
  EMPTY,
  type Fields,
  fieldsFrom,
  list,
  NO_SECRETS,
  normalize,
  type Secrets,
  type SetField,
} from "./fields";
import { LiveKitSection } from "./LiveKitSection";
import { TailscaleSection } from "./TailscaleSection";
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
  const queryClient = useQueryClient();
  const { data, isLoading } = useReachability(true);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [baseline, setBaseline] = useState<Fields>(EMPTY);
  const [secrets, setSecrets] = useState<Secrets>(NO_SECRETS);
  const [showOwnRelay, setShowOwnRelay] = useState(false);
  const [customControl, setCustomControl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Signature of the last settings taken from the server, so a poll that
  // brings back what we already have doesn't re-run the seeding.
  const seeded = useRef<string | null>(null);

  const set: SetField = (key, value) =>
    setFields((f) => ({ ...f, [key]: value }));

  const changes = changesFrom(fields, baseline, secrets);
  const dirty = Object.keys(changes).length > 0;

  // Seed the fields from what's in force. The query polls while a
  // Tailscale node comes up, so this re-seeds only when the server
  // reports something new — and never on top of unsaved edits.
  useEffect(() => {
    const r = data?.reachability;
    if (!r) return;
    const next = fieldsFrom(r);
    const sig = JSON.stringify(next);
    if (sig === seeded.current) return;
    if (seeded.current !== null && dirty) return;
    seeded.current = sig;
    setFields(next);
    setBaseline(next);
    if (list(next.turnUrls).length > 0) setShowOwnRelay(true);
    setCustomControl(next.tsControlUrl !== "");
  }, [data, dirty]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await instanceClient.updateReachability(changes);
      setBaseline(normalize(fields));
      setSecrets(NO_SECRETS);
      seeded.current = null;
      await queryClient.invalidateQueries({ queryKey: ["reachability"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <form className="reach-form" onSubmit={submit}>
      <AddressSection
        fields={fields}
        set={set}
        trustAll={data?.reachability?.trustedProxies?.trustAll ?? false}
      />

      <LiveKitSection lk={data?.livekit} />

      <TailscaleSection
        fields={fields}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        customControl={customControl}
        setCustomControl={setCustomControl}
        data={data}
      />

      <VoiceRelaySection
        fields={fields}
        set={set}
        secrets={secrets}
        setSecrets={setSecrets}
        showOwnRelay={showOwnRelay}
        setShowOwnRelay={setShowOwnRelay}
        saved={data?.reachability}
      />

      {/* What the settings above add up to, rather than what anyone
          intended: read back from the server after every save. */}
      <p className="reach-voice" data-voice={data?.voiceConfigured ?? false}>
        {voiceStatus(data)}
      </p>

      {error && <p className="error">{error}</p>}
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

import { type FormEvent, useState } from "react";
import { LearnMore } from "../../components/LearnMore";
import {
  clearCloudflareRelay,
  clearOwnRelay,
  list,
} from "../../components/ReachabilityForm/fields";
import { useReachabilityDraft } from "../../components/ReachabilityForm/useReachabilityDraft";
import {
  CloudflareRelayFields,
  OwnRelayFields,
} from "../../components/ReachabilityForm/VoiceRelaySection";
import { Choice } from "./Choice";
import type { Access } from "./steps";
import { WizardActions } from "./WizardActions";

type Relay = "cloudflare" | "own" | "none";

// Whether calls get through from where people connect. At home they do
// as they are; a tunnel carries no call audio, so it needs a relay.
export function VoiceStep({
  access,
  onDone,
  onBack,
  onLater,
}: {
  access: Access | undefined;
  onDone: () => void;
  onBack?: () => void;
  onLater: () => void;
}) {
  const [relay, setRelay] = useState<Relay | null>(null);
  const draft = useReachabilityDraft((seeded) =>
    setRelay(
      (r) =>
        r ??
        (seeded.cloudflareTurnEnabled
          ? "cloudflare"
          : list(seeded.turnUrls).length > 0
            ? "own"
            : "none"),
    ),
  );
  const { data, fields, set, secrets, setSecrets, form } = draft;

  const pick = (next: Relay) => {
    setRelay(next);
    set("cloudflareTurnEnabled", next === "cloudflare");
    if (next !== "cloudflare") clearCloudflareRelay(set, setSecrets);
    if (next !== "own") clearOwnRelay(set, setSecrets);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await draft.save()) onDone();
  };

  if (draft.isLoading) return <p className="muted">Loading…</p>;

  const running = data?.livekit?.running ?? false;
  const tunnel = access === "tunnel";
  const ready = access === "home" || access === "tailscale";
  return (
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>
          {tunnel
            ? "Voice needs a relay behind a tunnel."
            : ready
              ? "Voice is ready on your network."
              : "Calls from outside need a way in."}
        </strong>
      </p>
      <p className="hint">
        {tunnel
          ? "The tunnel carries chat, not call audio. A relay carries the audio."
          : access === "tailscale"
            ? "Calls ride your tailnet."
            : ready
              ? "Nothing to set up for calls at home."
              : "A relay carries call audio for people outside your network."}
      </p>
      <p className="setup-status" data-state={running ? "ok" : "bad"}>
        <span className="setup-dot" aria-hidden="true" />
        LiveKit {running ? "running" : "not running"}
      </p>
      {ready ? (
        <LearnMore label="Calling in from outside?">
          <p className="hint">
            Forward 7881/tcp and 50000–50100/udp to this machine, or add a relay
            later in Server admin.
          </p>
        </LearnMore>
      ) : (
        <Choice
          legend="Relay"
          name="relay"
          value={relay}
          onChange={pick}
          options={[
            {
              value: "cloudflare",
              title: "Cloudflare's TURN relay",
              hint: "Free up to 1 TB a month.",
              body: (
                <CloudflareRelayFields
                  fields={fields}
                  errors={form.errors}
                  set={set}
                  secrets={secrets}
                  setSecrets={setSecrets}
                  hasApiToken={
                    data?.reachability?.cloudflare?.hasApiToken ?? false
                  }
                />
              ),
            },
            {
              value: "own",
              title: "A TURN relay I run",
              hint: "coturn or similar, on a host people can reach.",
              body: (
                <OwnRelayFields
                  fields={fields}
                  errors={form.errors}
                  set={set}
                  secrets={secrets}
                  setSecrets={setSecrets}
                  hasCredential={
                    data?.reachability?.turn?.hasCredential ?? false
                  }
                />
              ),
            },
            {
              value: "none",
              title: "No relay",
              hint: "Calls work on your network, or with ports forwarded.",
            },
          ]}
        />
      )}
      {tunnel && relay === "none" && (
        <p className="callout warn">
          People coming through the tunnel won't hear anyone.
        </p>
      )}
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <WizardActions
        label="Continue"
        busy={draft.busy}
        onBack={onBack}
        onLater={onLater}
      />
    </form>
  );
}

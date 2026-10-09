import { type FormEvent, useState } from "react";
import { TunnelFields } from "../../components/ReachabilityForm/CloudflareTunnelSection";
import { withTunnelProxy } from "../../components/ReachabilityForm/fields";
import { TailscaleFields } from "../../components/ReachabilityForm/TailscaleSection";
import { useReachabilityDraft } from "../../components/ReachabilityForm/useReachabilityDraft";
import { Choice } from "./Choice";
import type { Access } from "./steps";
import { WizardActions } from "./WizardActions";

// Where people connect from. The tunnel and the tailnet are switched on
// here; a reverse proxy or the home network need nothing yet, and the
// address step fills itself in from the choice.
export function RemoteStep({
  access,
  onDone,
  onLater,
}: {
  access: Access | undefined;
  onDone: (access: Access) => void;
  onLater: () => void;
}) {
  const [choice, setChoice] = useState<Access | null>(access ?? null);
  const [customControl, setCustomControl] = useState(false);
  const draft = useReachabilityDraft((seeded) => {
    setCustomControl(seeded.tsControlUrl !== "");
    setChoice(
      (c) =>
        c ??
        (seeded.tunnelEnabled
          ? "tunnel"
          : seeded.tsEnabled
            ? "tailscale"
            : "home"),
    );
  });
  const { data, fields, set, secrets, setSecrets, form } = draft;

  const pick = (next: Access) => {
    setChoice(next);
    set("tunnelEnabled", next === "tunnel");
    set("proxies", withTunnelProxy(fields.proxies, next === "tunnel"));
    set("tsEnabled", next === "tailscale");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (choice && (await draft.save())) onDone(choice);
  };

  if (draft.isLoading) return <p className="muted">Loading…</p>;

  const missing = data?.cloudflareTunnel?.state === "missing";
  return (
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>Where will people connect from?</strong>
      </p>
      <p className="hint">You can change this later in Server admin.</p>
      <Choice
        legend="Pick one"
        name="access"
        value={choice}
        onChange={pick}
        options={[
          {
            value: "home",
            title: "Only my home network",
            hint: "Wi-Fi, LAN or your own VPN. Nothing to set up.",
          },
          {
            value: "proxy",
            title: "My own reverse proxy",
            hint: "Caddy, nginx, Traefik or similar, already in front.",
          },
          {
            value: "tunnel",
            title: "Cloudflare Tunnel",
            hint: "A public hostname, no ports opened on your router.",
            body: missing ? (
              <p className="hint">
                cloudflared isn't installed on this server.
              </p>
            ) : (
              <TunnelFields
                fields={fields}
                errors={form.errors}
                secrets={secrets}
                setSecrets={setSecrets}
                data={data}
              />
            ),
          },
          {
            value: "tailscale",
            title: "Tailscale",
            hint: "Stoop joins your tailnet. Public via Funnel if you want.",
            body: (
              <TailscaleFields
                fields={fields}
                errors={form.errors}
                set={set}
                secrets={secrets}
                setSecrets={setSecrets}
                customControl={customControl}
                setCustomControl={setCustomControl}
                data={data}
              />
            ),
          },
        ]}
      />
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <WizardActions label="Continue" busy={draft.busy} onLater={onLater} />
    </form>
  );
}

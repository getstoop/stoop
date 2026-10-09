import { type FormEvent, useEffect, useState } from "react";
import { Field } from "../../components/Field";
import { LearnMore } from "../../components/LearnMore";
import { list, TUNNEL_PROXIES } from "../../components/ReachabilityForm/fields";
import { useReachabilityDraft } from "../../components/ReachabilityForm/useReachabilityDraft";
import { onLoopback } from "./loopback";
import type { Access } from "./steps";
import { WizardActions } from "./WizardActions";

// The address invite links are built from, and whatever forwards
// requests here. Starts from what the remote access step picked.
export function AddressStep({
  access,
  onDone,
  onBack,
}: {
  access: Access | undefined;
  onDone: () => void;
  onBack?: () => void;
}) {
  const [filled, setFilled] = useState(false);
  const [touched, setTouched] = useState(false);
  const draft = useReachabilityDraft((seeded) => {
    if (filled || seeded.publicUrl !== "") return;
    setFilled(true);
    if ((access === "home" || access === "proxy") && !onLoopback()) {
      set("publicUrl", window.location.origin);
    }
  });
  const { fields, set, form } = draft;

  // A node still joining has no URL yet; the status poll brings it, and
  // an address nobody has typed in takes it then.
  const node = draft.data?.tailscale?.url;
  useEffect(() => {
    if (access !== "tailscale" || !node || touched) return;
    if (fields.publicUrl === "") set("publicUrl", node);
  }, [access, node, touched, fields.publicUrl, set]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await draft.save()) onDone();
  };

  if (draft.isLoading) return <p className="muted">Loading…</p>;

  const proxies = access === "proxy" || access === "tunnel";
  const tunnelOnly =
    access === "tunnel" &&
    list(fields.proxies).every((p) => TUNNEL_PROXIES.includes(p));
  return (
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>What address will people use?</strong>
      </p>
      <p className="hint">Invite links are built from it.</p>
      {onLoopback() && fields.publicUrl.trim() === "" && (
        <p className="callout warn">
          You're on <code>{window.location.hostname}</code>, which only works on
          this machine.
        </p>
      )}
      <Field
        label="Public address"
        error={form.errors.publicUrl}
        hint={addressHint(access)}
      >
        <input
          value={fields.publicUrl}
          onChange={(e) => {
            setTouched(true);
            set("publicUrl", e.target.value);
          }}
          placeholder={
            access === "home"
              ? "http://192.168.1.20:8080"
              : "https://chat.example.com"
          }
          inputMode="url"
        />
      </Field>
      {proxies ? (
        <>
          <Field
            label="Trusted proxies"
            error={form.errors["trustedProxies.cidrs"]}
            hint={
              tunnelOnly
                ? "Filled in for the tunnel: cloudflared runs on this machine."
                : "Your proxy's address or range, like 192.168.1.5 or 10.0.0.0/8."
            }
          >
            <input
              value={fields.proxies}
              onChange={(e) => set("proxies", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <LearnMore label="What is a trusted proxy?">
            <p className="hint">
              Whatever forwards requests to Stoop. Stoop takes the visitor's
              address from it, so only list addresses that really are your
              proxy.
            </p>
          </LearnMore>
        </>
      ) : (
        <p className="hint">
          Nothing sits in front of Stoop, so there are no proxies to trust.
        </p>
      )}
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <WizardActions label="Continue" busy={draft.busy} onBack={onBack} />
    </form>
  );
}

function addressHint(access: Access | undefined): string {
  switch (access) {
    case "tunnel":
      return "The hostname you routed to your tunnel in Cloudflare.";
    case "tailscale":
      return "Your node's address on the tailnet.";
    case "proxy":
      return "The address your proxy serves Stoop on.";
    default:
      return "This machine's LAN address, or a name like stoop.lan.";
  }
}

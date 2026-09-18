import type { Dispatch, SetStateAction } from "react";
import type { instanceClient } from "../../api/clients";
import type { Reachability } from "../../gen/stoop/instance/v1/reachability_pb";

// The form's state model: what the inputs hold, how it is seeded from the
// server, and how the difference from the baseline becomes a request.
// Nothing here renders.

// Fields is the editable state in the shape the inputs hold it (lists as
// the comma-separated text you type). Two copies exist: what's on screen,
// and the baseline last seen from the server. Their difference is the
// request.
export type Fields = {
  publicUrl: string;
  proxies: string;
  cfKey: string;
  cloudflareTurnEnabled: boolean;
  turnUrls: string;
  turnUser: string;
  stunUrls: string;
  tsEnabled: boolean;
  tsHostname: string;
  tsFunnel: boolean;
  tsControlUrl: string;
  tunnelEnabled: boolean;
};

// Secrets are write-only: the server never sends them back, so there's
// nothing to compare them against. A non-empty box is the change.
export type Secrets = {
  cfToken: string;
  turnCred: string;
  tsAuthKey: string;
  tunnelToken: string;
};

export const NO_SECRETS: Secrets = {
  cfToken: "",
  turnCred: "",
  tsAuthKey: "",
  tunnelToken: "",
};

export const EMPTY: Fields = {
  publicUrl: "",
  proxies: "",
  cfKey: "",
  cloudflareTurnEnabled: false,
  turnUrls: "",
  turnUser: "",
  stunUrls: "",
  tsEnabled: false,
  tsHostname: "",
  tsFunnel: false,
  tsControlUrl: "",
  tunnelEnabled: false,
};

// What a section gets to edit with: one field at a time, or the secrets.
export type SetField = <K extends keyof Fields>(
  key: K,
  value: Fields[K],
) => void;
export type SetSecrets = Dispatch<SetStateAction<Secrets>>;

export const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const sameList = (a: string, b: string) =>
  list(a).join(" ") === list(b).join(" ");

// What the server stores is the trimmed value, so the baseline has to be
// trimmed too — otherwise a stray space reads as an unsaved change for
// ever after.
export function normalize(f: Fields): Fields {
  return {
    ...f,
    publicUrl: f.publicUrl.trim(),
    cfKey: f.cfKey.trim(),
    turnUser: f.turnUser.trim(),
    tsHostname: f.tsHostname.trim(),
    tsControlUrl: f.tsControlUrl.trim(),
  };
}

export function fieldsFrom(r: Reachability): Fields {
  return {
    publicUrl: r.publicUrl,
    proxies: r.trustedProxies?.cidrs.join(", ") ?? "",
    cfKey: r.cloudflare?.keyId ?? "",
    // Nothing on the wire says "Cloudflare TURN is on" — a saved key id
    // is what turns it on, so that's what ticks the box.
    cloudflareTurnEnabled: (r.cloudflare?.keyId ?? "") !== "",
    turnUrls: r.turn?.urls.join(", ") ?? "",
    turnUser: r.turn?.username ?? "",
    stunUrls: r.turn?.stunUrls.join(", ") ?? "",
    tsEnabled: r.tailscale?.enabled ?? false,
    tsHostname: r.tailscale?.hostname ?? "",
    tsFunnel: r.tailscale?.funnel ?? false,
    tsControlUrl: r.tailscale?.controlUrl ?? "",
    tunnelEnabled: r.cloudflareTunnel?.enabled ?? false,
  };
}

// Where cloudflared, as Stoop's child process, calls from: localhost
// resolves to either.
export const TUNNEL_PROXIES = ["127.0.0.1", "::1"];

// Ticking the tunnel names its connector under Trusted proxies and
// unticking takes it back out, so the list on screen is all the trust
// there is.
export function withTunnelProxy(proxies: string, on: boolean): string {
  const rest = list(proxies).filter((p) => !TUNNEL_PROXIES.includes(p));
  return (on ? [...rest, ...TUNNEL_PROXIES] : rest).join(", ");
}

export type Update = Parameters<typeof instanceClient.updateReachability>[0];

// changesFrom builds the request: one entry per group whose values differ
// from the baseline, and nothing at all when nothing was touched. The
// groups left out are the point — the server leaves an unset field
// exactly as it found it.
export function changesFrom(
  now: Fields,
  base: Fields,
  secrets: Secrets,
): Update {
  const req: Update = {};
  if (now.publicUrl.trim() !== base.publicUrl) {
    req.publicUrl = now.publicUrl.trim();
  }
  if (!sameList(now.proxies, base.proxies)) {
    req.trustedProxies = { cidrs: list(now.proxies) };
  }
  if (now.cfKey.trim() !== base.cfKey || secrets.cfToken !== "") {
    req.cloudflare = { keyId: now.cfKey.trim(), apiToken: secrets.cfToken };
  }
  if (
    !sameList(now.turnUrls, base.turnUrls) ||
    !sameList(now.stunUrls, base.stunUrls) ||
    now.turnUser.trim() !== base.turnUser ||
    secrets.turnCred !== ""
  ) {
    req.turn = {
      urls: list(now.turnUrls),
      username: now.turnUser.trim(),
      credential: secrets.turnCred,
      stunUrls: list(now.stunUrls),
    };
  }
  const funnel = now.tsEnabled && now.tsFunnel;
  if (
    now.tsEnabled !== base.tsEnabled ||
    funnel !== base.tsFunnel ||
    now.tsHostname.trim() !== base.tsHostname ||
    now.tsControlUrl.trim() !== base.tsControlUrl ||
    secrets.tsAuthKey !== ""
  ) {
    req.tailscale = {
      enabled: now.tsEnabled,
      hostname: now.tsHostname.trim(),
      funnel,
      authKey: secrets.tsAuthKey,
      controlUrl: now.tsControlUrl.trim(),
    };
  }
  // A token typed and then hidden by unticking goes nowhere: the server
  // would refuse a bad one before it read "off".
  const tunnelToken = now.tunnelEnabled ? secrets.tunnelToken.trim() : "";
  if (now.tunnelEnabled !== base.tunnelEnabled || tunnelToken !== "") {
    req.cloudflareTunnel = { enabled: now.tunnelEnabled, token: tunnelToken };
  }
  return req;
}

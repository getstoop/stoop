import { Code, ConnectError } from "@connectrpc/connect";
import type { InvitePreview } from "@stoop/gen/stoop/chat/v1/invite_pb";
import { chatClient } from "./clients";
import { normalizeServerUrl, type Probe, probeServer } from "./probe";

// Invite links, as web's inviteLink() writes them: <origin>/join/<code>,
// sometimes with a ?space= hint nobody here reads. The link carries the
// server as well as the code, so pasting it is all a phone needs; a bare
// code says nothing about which server it is for.

export type InviteLink = { origin: string; code: string };

export type InviteCheck =
  | { kind: "found"; origin: string; code: string; serverName: string; preview: InvitePreview }
  // Unknown, revoked, expired or used up, in the server's words.
  | { kind: "gone"; message: string }
  | { kind: "failed"; message: string }
  // The server itself was the trouble: Add a server's own findings.
  | { kind: "server"; probe: Exclude<Probe, { kind: "found" }> };

// Whatever was pasted, as a server and a code, or null when it is not an
// invite link. https:// is assumed when no scheme was given.
export function parseInviteLink(input: string): InviteLink | null {
  const text = input.trim();
  const origin = normalizeServerUrl(text);
  if (!origin) return null;
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  const match = /^\/join\/([^/]+)\/?$/.exec(new URL(withScheme).pathname);
  if (!match) return null;
  return { origin, code: decodeURIComponent(match[1]) };
}

// Asks the server whether it is one this app can use, then what the
// invite is for. LookupInvite needs no session.
export async function checkInvite(link: InviteLink, signal: AbortSignal): Promise<InviteCheck> {
  const probe = await probeServer(link.origin, signal);
  if (probe.kind !== "found") return { kind: "server", probe };
  try {
    const res = await chatClient(link.origin).lookupInvite({ code: link.code }, { signal });
    if (!res.preview) return { kind: "failed", message: "The server didn't describe the invite." };
    return { kind: "found", ...link, serverName: probe.name, preview: res.preview };
  } catch (err) {
    const message = err instanceof ConnectError ? err.rawMessage : String(err);
    return inviteGone(err) ? { kind: "gone", message } : { kind: "failed", message };
  }
}

// Joins the invite's space as an account already signed in.
export async function joinWithInvite(origin: string, token: string, code: string): Promise<void> {
  await chatClient(origin, token).joinSpace({ code });
}

// As web's inviteGone: the invite itself is dead, rather than a reason
// worth trying again.
function inviteGone(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    (err.code === Code.NotFound ||
      err.code === Code.FailedPrecondition ||
      err.code === Code.ResourceExhausted)
  );
}

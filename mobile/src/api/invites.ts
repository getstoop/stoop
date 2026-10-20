import { Code, ConnectError } from "@connectrpc/connect";
import type { InvitePreview } from "@stoop/gen/stoop/chat/v1/invite_pb";
import { PasswordSignIn, RegistrationPolicy } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { chatClient, instanceClient } from "./clients";
import { normalizeServerUrl, type Probe, probeServer } from "./probe";

// Invite links, as web's inviteLink() writes them: <origin>/join/<code>,
// sometimes with a ?space= hint nobody here reads. The link carries the
// server as well as the code, so pasting it is all a phone needs; a bare
// code says nothing about which server it is for.

export type InviteLink = { origin: string; code: string };

// Long enough for a slow server, short enough that one which stops
// answering ends in an error rather than a screen left waiting.
const TIMEOUT_MS = 10000;

export type InviteCheck =
  | {
      kind: "found";
      origin: string;
      code: string;
      serverName: string;
      preview: InvitePreview;
      // Whether the server takes a new password account here; when it
      // doesn't, the invite is for someone already on the server.
      canCreate: boolean;
    }
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
  try {
    return { origin, code: decodeURIComponent(match[1]) };
  } catch {
    // A stray % in the code: not a link the server wrote.
    return null;
  }
}

// Asks the server whether it is one this app can use, then what the
// invite is for and whether it takes new accounts. Neither call needs a
// session.
export async function checkInvite(link: InviteLink, signal: AbortSignal): Promise<InviteCheck> {
  const probe = await probeServer(link.origin, signal);
  if (probe.kind !== "found") return { kind: "server", probe };
  try {
    const [res, canCreate] = await Promise.all([
      chatClient(link.origin).lookupInvite({ code: link.code }, { signal, timeoutMs: TIMEOUT_MS }),
      takesNewAccounts(link.origin, signal),
    ]);
    if (!res.preview) return { kind: "failed", message: "The server didn't describe the invite." };
    return { kind: "found", ...link, serverName: probe.name, preview: res.preview, canCreate };
  } catch (err) {
    const message = err instanceof ConnectError ? err.rawMessage : String(err);
    return inviteGone(err) ? { kind: "gone", message } : { kind: "failed", message };
  }
}

// Joins the invite's space as an account already signed in.
export async function joinWithInvite(origin: string, token: string, code: string): Promise<void> {
  await chatClient(origin, token).joinSpace({ code }, { timeoutMs: TIMEOUT_MS });
}

// As the server's own check: an invite admits a new account unless
// registration is closed, and the account is a password one only where
// password sign-in is open to everyone. When the status can't be read,
// the form shows and Register says what is wrong.
async function takesNewAccounts(origin: string, signal: AbortSignal): Promise<boolean> {
  try {
    const s = await instanceClient(origin).getInstanceStatus({}, { signal, timeoutMs: TIMEOUT_MS });
    return (
      s.registrationPolicy !== RegistrationPolicy.CLOSED &&
      s.passwordSignIn === PasswordSignIn.EVERYONE
    );
  } catch {
    return true;
  }
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

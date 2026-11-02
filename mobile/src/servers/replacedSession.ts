import { clearFileCaches } from "../api/downloads";
import { type SavedServer, sessionToken } from "../api/servers";
import { endSession } from "./endSession";

// Signing in to a server already saved, as anyone (one account can't be
// told from another without asking the server): the new session goes in
// under the same ID. What the old one leaves behind is dealt with here,
// once the new one is saved.

export type Replaced = { origin: string; token: string | null };

// The session a sign-in to origin is about to replace, or null when the
// server is new here. To be read before the new token is saved. Its token
// is null when there is none to read, which still replaces a session.
export async function sessionToReplace(servers: SavedServer[], origin: string): Promise<Replaced | null> {
  const known = servers.find((server) => server.origin === origin);
  if (!known) return null;
  return { origin, token: await sessionToken(known.id).catch(() => null) };
}

// As signing out: the old session ends on the server, and the pictures and
// files fetched with it are forgotten. Neither stands in the way of the new
// session, which is already saved.
export async function endReplaced(replaced: Replaced, newToken: string) {
  if (replaced.token && replaced.token !== newToken) endSession(replaced.origin, replaced.token);
  await clearFileCaches().catch(() => {});
}

import { Code, ConnectError } from "@connectrpc/connect";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";
import { type SavedServer, sessionToken } from "./servers";

// The signed-in account on a server, as the You tab shows it.

const TIMEOUT_MS = 10000;

export async function loadMe(origin: string, token: string): Promise<User | undefined> {
  const { user } = await authClient(origin, token).getMe({}, { timeoutMs: TIMEOUT_MS });
  return user;
}

// Whether the server itself says this session is over: Unauthenticated, in
// a Connect error with a message of its own. An unreachable server, a 5xx
// or a timeout says nothing about the session, and neither does a 401 from
// something in front of the server, which Connect also reads as
// Unauthenticated, with the message "HTTP 401", or none from JSON of another
// shape.
export async function isSessionOver(origin: string, token: string): Promise<boolean> {
  try {
    await loadMe(origin, token);
    return false;
  } catch (err) {
    return (
      err instanceof ConnectError &&
      err.code === Code.Unauthenticated &&
      err.rawMessage !== "" &&
      !/^HTTP \d+$/.test(err.rawMessage)
    );
  }
}

export type SignedInMe =
  | { state: "ready"; token: string; user: User }
  // As the Spaces tab: only the server saying the session is over counts
  // as signed out.
  | { state: "ended" }
  | { state: "failed" };

// Who is signed in to this server, with the token that asked, for a screen
// that shows the account or the way back in.
export async function loadSignedInMe(server: SavedServer): Promise<SignedInMe> {
  const token = await sessionToken(server.id).catch(() => null);
  if (!token) return { state: "ended" };
  try {
    const user = await loadMe(server.origin, token);
    return user ? { state: "ready", token, user } : { state: "ended" };
  } catch (err) {
    return err instanceof ConnectError && err.code === Code.Unauthenticated ? { state: "ended" } : { state: "failed" };
  }
}

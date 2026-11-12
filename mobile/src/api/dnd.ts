import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";
import { type SavedServer, sessionToken } from "./servers";

// Do not disturb on one server's account. It belongs to the account, so
// every device signed in to that server follows it.

const TIMEOUT_MS = 10000;

// Turns it on, until an end or with none, or off. Resolves with the
// account as the server then has it; rejects when signed out there or
// the server can't be reached.
export async function setDoNotDisturb(server: SavedServer, on: boolean, until: Date | undefined): Promise<User | undefined> {
  const token = await sessionToken(server.id);
  if (!token) throw new Error("Signed out.");
  const { user } = await authClient(server.origin, token).setDoNotDisturb(
    { on, until: until ? timestampFromDate(until) : undefined },
    { timeoutMs: TIMEOUT_MS },
  );
  return user;
}

import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";

// The signed-in account on a server, as the You tab shows it.

const TIMEOUT_MS = 10000;

export async function loadMe(origin: string, token: string): Promise<User | undefined> {
  const { user } = await authClient(origin, token).getMe({}, { timeoutMs: TIMEOUT_MS });
  return user;
}

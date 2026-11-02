import { authClient } from "../api/clients";

const LOGOUT_TIMEOUT_MS = 5000;

// Sends a session's end and doesn't wait on it, so nothing waits on a
// server that may never answer. Best effort: a session already over is
// refused, one the server never hears this for runs out by itself, and
// neither is anything to tell the person. It ends only the session the
// token is: any other of that account, on this device or not, carries on.
export function endSession(origin: string, token: string) {
  authClient(origin, token)
    .logout({}, { timeoutMs: LOGOUT_TIMEOUT_MS })
    .catch(() => {});
}

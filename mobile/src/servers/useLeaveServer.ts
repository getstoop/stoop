import { useCallback } from "react";
import { authClient } from "../api/clients";
import { sessionToken, type SavedServer } from "../api/servers";
import { useServers } from "./index";

const LOGOUT_TIMEOUT_MS = 5000;

// Takes a server off this phone: signing out of it, or removing it. The
// session's end is sent first and not waited on, so nothing waits on a
// server that may never answer, and it is on its way even if forgetting
// the server then fails. A rejection means the server is still saved here,
// though its session may be over.
export function useLeaveServer() {
  const { forget } = useServers();
  return useCallback(
    async (server: SavedServer) => {
      const token = await sessionToken(server.id).catch(() => null);
      if (token) {
        authClient(server.origin, token)
          .logout({}, { timeoutMs: LOGOUT_TIMEOUT_MS })
          .catch(() => {});
      }
      await forget(server.id);
    },
    [forget],
  );
}

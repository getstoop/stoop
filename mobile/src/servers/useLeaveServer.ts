import { useCallback } from "react";
import { sessionToken, type SavedServer } from "../api/servers";
import { endSession } from "./endSession";
import { useServers } from "./index";

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
      if (token) endSession(server.origin, token);
      await forget(server.id);
    },
    [forget],
  );
}

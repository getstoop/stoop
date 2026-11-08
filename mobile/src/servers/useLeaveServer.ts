import { useCallback } from "react";
import { deleteServerDrafts } from "../api/drafts";
import { sessionToken, type SavedServer } from "../api/servers";
import { endSession } from "./endSession";
import { useServers } from "./index";

// Takes a server off this phone: signing out of it, or removing it. The
// session's end is sent first and not waited on, so nothing waits on a
// server that may never answer, and it is on its way even if forgetting
// the server then fails. A rejection means the server is still saved here,
// though its session may be over. Once it is forgotten, every account's
// drafts for it go too (docs/proposals/drafts.md). The store refuses a
// write for a server not in its saved set, which the provider updates as
// the list changes and deleteServerDrafts trims itself, so a composer
// saving as it goes away, or a send failing late, can't write them back.
export function useLeaveServer() {
  const { forget } = useServers();
  return useCallback(
    async (server: SavedServer) => {
      const token = await sessionToken(server.id).catch(() => null);
      if (token) endSession(server.origin, token);
      await forget(server.id);
      deleteServerDrafts(server.id);
    },
    [forget],
  );
}

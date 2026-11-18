import { useCallback } from "react";
import { useForgetServerAlerts } from "../alertPrefs/AlertPrefsProvider";
import { deleteServerDrafts } from "../api/drafts";
import { sessionToken, type SavedServer } from "../api/servers";
import { useForgetServerSpace } from "../lastSpace/LastSpaceProvider";
import { usePushLeave } from "../push/PushProvider";
import { endSession } from "./endSession";
import { useServers } from "./index";

// Takes a server off this phone: signing out of it, or removing it. The
// session's end is sent first and not waited on, so nothing waits on a
// server that may never answer, and it is on its way even if forgetting
// the server then fails. Just before it goes the push subscription's
// removal (src/push), while the session can still ask: the session's
// end follows that answer, or its five seconds running out, and the
// phone forgets the push keys and record whatever the server says. A rejection means the server is still saved here,
// though its session may be over. Once it is forgotten, every account's
// drafts for it go too (docs/architecture/messaging.md → The composer),
// and so do its switch on the Notifications screen (src/alertPrefs) and
// the space its Spaces tab last showed (src/lastSpace).
// The store refuses a write for a server not in its saved set, which the
// provider updates as the list changes and deleteServerDrafts trims
// itself, so a composer saving as it goes away, or a send failing late,
// can't write them back.
export function useLeaveServer() {
  const { forget } = useServers();
  const forgetAlerts = useForgetServerAlerts();
  const forgetSpace = useForgetServerSpace();
  const leavePush = usePushLeave();
  return useCallback(
    async (server: SavedServer) => {
      const token = await sessionToken(server.id).catch(() => null);
      void leavePush({ id: server.id, origin: server.origin, session: server.session ?? 0 }, token).then(() => {
        if (token) endSession(server.origin, token);
      });
      await forget(server.id);
      deleteServerDrafts(server.id);
      forgetAlerts(server.id);
      forgetSpace(server.id);
    },
    [forget, forgetAlerts, forgetSpace, leavePush],
  );
}

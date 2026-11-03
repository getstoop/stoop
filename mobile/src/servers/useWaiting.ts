import { Code, ConnectError } from "@connectrpc/connect";
import { alertingTotal } from "@stoop/core/alerts";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAlertLists } from "../api/alerts";
import { sessionToken } from "../api/servers";
import type { SavedServer } from "./index";

// What is waiting on the servers other than the current one, for the
// switcher and the You tab: a badge's count, the same total that server's
// Activity tab shows (src/alerts): the server's alert counts over its
// spaces, less the muted ones, plus one per conversation with unread
// messages (core/alerts alertingTotal), or a sign-in that has ended.
export type Waiting =
  | { state: "ready"; count: number }
  | { state: "ended" }
  | { state: "failed" };

// Only no session kept here, or the server saying it is over, counts as
// signed out. A server that can't be reached, or a keychain that won't
// give up the token, just shows no badge.
export async function waitingOn(server: SavedServer): Promise<Waiting> {
  try {
    const token = await sessionToken(server.id);
    if (!token) return { state: "ended" };
    const { spaces, dms } = await loadAlertLists(server.origin, token);
    return { state: "ready", count: alertingTotal(spaces, dms) };
  } catch (err) {
    return err instanceof ConnectError && err.code === Code.Unauthenticated
      ? { state: "ended" }
      : { state: "failed" };
  }
}

// Each server is asked when the list changes and on refresh. By server
// ID; a server not in there yet is still being asked. An answer stays
// until the next one, and one from an older round is dropped.
export function useWaiting(servers: SavedServer[], current: string | undefined) {
  const [waiting, setWaiting] = useState<Record<string, Waiting>>({});
  const round = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++round.current;
    await Promise.all(
      servers
        .filter((server) => server.id !== current)
        .map((server) =>
          waitingOn(server).then((w) => {
            if (mine === round.current) setWaiting((all) => ({ ...all, [server.id]: w }));
          }),
        ),
    );
  }, [servers, current]);

  useEffect(() => {
    refresh();
    return () => {
      round.current++;
    };
  }, [refresh]);

  return { waiting, refresh };
}

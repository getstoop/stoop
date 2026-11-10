import { Code, ConnectError } from "@connectrpc/connect";
import { alertingTotal } from "@stoop/core/alerts";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { loadAlertLists, touchesAlerts } from "../api/alerts";
import { sessionToken } from "../api/servers";

// One session's badge total (core/alerts alertingTotal), asked for
// again rather than kept up here: the server's counts on its spaces and
// conversations (api/alerts). Whoever holds this (AlertsProvider.tsx)
// asks on mounting and on coming back to the app, and hands it every
// event of the server's socket: one that could change the total
// (touchesAlerts, Ready among them) asks again after a moment's quiet.
// A screen asks too when it changes something no event tells (the
// Messages tab closing a conversation). A load that fails keeps the
// last total. CredentialRevoked, no session kept, or the server
// refusing it says the session has ended: the total is none, and
// nothing more is asked.

export type AlertsLoader = {
  // Asks the server again; resolves once the answer has landed.
  refresh: () => Promise<void>;
  event: (event: ServerEvent) => void;
  // Nothing lands after this, and nothing more is asked.
  stop: () => void;
};

// Events come in bursts (a message sent is also its channel read), so a
// moment's quiet goes before one load.
export const RELOAD_DELAY_MS = 300;

const unauthenticated = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

export function alertsLoader(server: { id: string; origin: string }, onTotal: (total: number) => void): AlertsLoader {
  // Loads can overlap (opening, Ready, an event), and an older one
  // finishing last must not undo a newer one: only the latest started
  // counts, and stopping makes none the latest.
  let latest = 0;
  let over = false;
  let reload: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    over = true;
    latest++;
    clearTimeout(reload);
  };

  const end = () => {
    if (over) return;
    stop();
    onTotal(0);
  };

  const refresh = async () => {
    if (over) return;
    const mine = ++latest;
    const session = await sessionToken(server.id).catch(() => null);
    if (mine !== latest) return;
    if (!session) {
      end();
      return;
    }
    try {
      const { spaces, dms } = await loadAlertLists(server.origin, session);
      if (mine === latest) onTotal(alertingTotal(spaces, dms));
    } catch (err) {
      // An older load refused says the same as the latest would.
      if (unauthenticated(err)) end();
    }
  };

  const event = (event: ServerEvent) => {
    if (over) return;
    if (event.payload.case === "credentialRevoked") {
      end();
      return;
    }
    if (!touchesAlerts(event)) return;
    clearTimeout(reload);
    reload = setTimeout(refresh, RELOAD_DELAY_MS);
  };

  return { refresh, event, stop };
}

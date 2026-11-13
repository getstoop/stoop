import { alertingTotal } from "@stoop/core/alerts";
import { dmUnreadTotal } from "@stoop/core/dms";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";

// Every saved server's badges, by server ID, with the way to ask each
// again: filled by one loader per session (loader.ts) and read by that
// server's Activity and Messages tabs and by the app's icon, which
// shows the totals added up. Held outside React so a reader follows
// only what it reads (useSyncExternalStore), not every change on every
// server.

// One server's badges, each off the same two lists (api/alerts).
export type ServerBadges = {
  // The Activity tab's: what is addressed to the reader in the spaces,
  // past their markers.
  activity: number;
  // The Messages tab's: the unread messages in the conversations, as
  // web's DM pill counts them (core/dms dmUnreadTotal).
  messages: number;
  // The app icon's share, and the switcher's: the spaces' count plus
  // one per conversation with unread messages (core/alerts
  // alertingTotal), so one busy conversation counts once there.
  total: number;
};

export const NO_BADGES: Readonly<ServerBadges> = { activity: 0, messages: 0, total: 0 };

export function serverBadges(spaces: Space[] | undefined, dms: DirectMessage[] | undefined): ServerBadges {
  return {
    activity: alertingTotal(spaces, undefined),
    messages: dmUnreadTotal(dms),
    total: alertingTotal(spaces, dms),
  };
}

export type AlertsStore = {
  // What a server's badges show: none for a server not in here, which
  // has not answered yet. The same object until a number changes.
  badges: (serverId: string) => ServerBadges;
  // undefined takes the server out: its session is gone.
  set: (serverId: string, badges: ServerBadges | undefined) => void;
  subscribe: (listener: () => void) => () => void;
  // Asks a server again; resolves once the answer has landed, at once
  // when nothing loads for that server.
  refresh: (serverId: string) => Promise<void>;
  // How a server's badges are asked for again (its loader's), until
  // removed by the returned function.
  setRefresh: (serverId: string, refresh: () => Promise<void>) => () => void;
};

const same = (a: ServerBadges | undefined, b: ServerBadges | undefined) =>
  a === b || (!!a && !!b && a.activity === b.activity && a.messages === b.messages && a.total === b.total);

export function alertsStore(): AlertsStore {
  const held = new Map<string, ServerBadges>();
  const loads = new Map<string, () => Promise<void>>();
  const listeners = new Set<() => void>();
  return {
    badges: (serverId) => held.get(serverId) ?? NO_BADGES,
    set: (serverId, badges) => {
      if (same(held.get(serverId), badges)) return;
      if (badges === undefined) held.delete(serverId);
      else held.set(serverId, badges);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: (serverId) => loads.get(serverId)?.() ?? Promise.resolve(),
    setRefresh: (serverId, refresh) => {
      loads.set(serverId, refresh);
      return () => {
        // A new session on the same server may have said its own since.
        if (loads.get(serverId) === refresh) loads.delete(serverId);
      };
    },
  };
}

// The one number on the app's icon: what waits on every saved server,
// each adding its total. A server whose sign-in has ended holds 0 and
// one that has not answered holds nothing, so neither adds anything;
// one no longer saved is not asked about.
export function waitingEverywhere(servers: { id: string }[], total: (serverId: string) => number): number {
  let sum = 0;
  for (const server of servers) sum += total(server.id);
  return sum;
}

// The number on the server chip by the tab bar: what waits on the saved
// servers other than the one on screen, added up the same way.
export function waitingElsewhere(
  servers: { id: string }[],
  current: string,
  total: (serverId: string) => number,
): number {
  return waitingEverywhere(
    servers.filter((server) => server.id !== current),
    total,
  );
}

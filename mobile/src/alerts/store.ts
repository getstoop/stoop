// Every saved server's badge total, by server ID, with the way to ask
// each again: filled by one loader per session (loader.ts) and read by
// that server's Activity tab and by the app's icon, which shows them
// added up. Held outside React so a reader follows only what it reads
// (useSyncExternalStore), not every change on every server.

export type AlertsStore = {
  // What a server's badge shows: 0 for a server not in here, which
  // has not answered yet.
  total: (serverId: string) => number;
  // undefined takes the server out: its session is gone.
  set: (serverId: string, total: number | undefined) => void;
  subscribe: (listener: () => void) => () => void;
  // Asks a server again; resolves once the answer has landed, at once
  // when nothing loads for that server.
  refresh: (serverId: string) => Promise<void>;
  // How a server's total is asked for again (its loader's), until
  // removed by the returned function.
  setRefresh: (serverId: string, refresh: () => Promise<void>) => () => void;
};

export function alertsStore(): AlertsStore {
  const totals = new Map<string, number>();
  const loads = new Map<string, () => Promise<void>>();
  const listeners = new Set<() => void>();
  return {
    total: (serverId) => totals.get(serverId) ?? 0,
    set: (serverId, total) => {
      if (totals.get(serverId) === total) return;
      if (total === undefined) totals.delete(serverId);
      else totals.set(serverId, total);
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
// each adding what its Activity tab's badge shows. A server whose
// sign-in has ended holds 0 and one that has not answered holds
// nothing, so neither adds anything; one no longer saved is not asked
// about.
export function waitingEverywhere(servers: { id: string }[], total: (serverId: string) => number): number {
  let sum = 0;
  for (const server of servers) sum += total(server.id);
  return sum;
}

// One kind of roster for every server, by server ID: undefined while that
// server's socket is not connected and nobody can say. Held outside React
// so a screen follows only what it reads (useSyncExternalStore), not every
// change on every server.
export type RosterStore<Roster> = {
  get: (serverId: string) => Roster | undefined;
  set: (serverId: string, roster: Roster | undefined) => void;
  subscribe: (listener: () => void) => () => void;
};

export function rosterStore<Roster>(): RosterStore<Roster> {
  const rosters = new Map<string, Roster | undefined>();
  const listeners = new Set<() => void>();
  return {
    get: (serverId) => rosters.get(serverId),
    set: (serverId, roster) => {
      if (rosters.get(serverId) === roster) return;
      rosters.set(serverId, roster);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

import { type AlertPrefs, DEFAULT_PREFS, withoutServer, withServer } from "./prefs";

// The prefs held outside React so a notification can ask as it arrives.
// The defaults stand until the saved ones are read, and a read that
// comes after the person has changed one is dropped: theirs stands.
export type AlertPrefsStore = {
  // The same object until it changes.
  current: () => AlertPrefs;
  subscribe: (listener: () => void) => () => void;
  loaded: (saved: AlertPrefs) => void;
  set: (change: Partial<AlertPrefs>) => void;
  setServer: (serverId: string, on: boolean) => void;
  // A removed server's switch goes with it.
  forgetServer: (serverId: string) => void;
};

export function alertPrefsStore(save: (next: AlertPrefs) => void): AlertPrefsStore {
  let prefs = DEFAULT_PREFS;
  let moved = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const replace = (next: AlertPrefs) => {
    moved = true;
    prefs = next;
    save(prefs);
    notify();
  };
  return {
    current: () => prefs,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loaded: (saved) => {
      if (moved) return;
      prefs = saved;
      notify();
    },
    set: (change) => replace({ ...prefs, ...change }),
    setServer: (serverId, on) => replace(withServer(prefs, serverId, on)),
    forgetServer: (serverId) => {
      // Nothing kept for it: nothing to save, and no hold on a read still to come.
      if (!(serverId in prefs.servers)) return;
      replace(withoutServer(prefs, serverId));
    },
  };
}

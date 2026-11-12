import { type AlertPrefs, DEFAULT_PREFS } from "./prefs";

// The prefs held outside React so a notification can ask as it arrives.
// The defaults stand until the saved ones are read, and a read that
// comes after the person has changed one is dropped: theirs stands.
export type AlertPrefsStore = {
  // The same object until it changes.
  current: () => AlertPrefs;
  subscribe: (listener: () => void) => () => void;
  loaded: (saved: AlertPrefs) => void;
  set: (change: Partial<AlertPrefs>) => void;
};

export function alertPrefsStore(save: (next: AlertPrefs) => void): AlertPrefsStore {
  let prefs = DEFAULT_PREFS;
  let moved = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
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
    set: (change) => {
      moved = true;
      prefs = { ...prefs, ...change };
      save(prefs);
      notify();
    },
  };
}

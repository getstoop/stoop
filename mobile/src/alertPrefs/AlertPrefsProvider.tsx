import * as SecureStore from "expo-secure-store";
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { type AlertPrefs, parsePrefs } from "./prefs";
import { type AlertPrefsStore, alertPrefsStore } from "./store";

// What this phone alerts about (prefs.ts), at the root of the app so a
// notification can ask as it arrives. Kept in the keychain beside the
// theme and do not disturb: the phone's own, never sent to a server.

const KEY = "alert-prefs";

const AlertPrefsContext = createContext<AlertPrefsStore | null>(null);

export default function AlertPrefsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    alertPrefsStore(
      // A failed save only means the next launch opens on the prefs before.
      (next) => void SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {}),
    ),
  );

  // A read the keychain refuses is the defaults.
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .catch(() => null)
      .then((raw) => store.loaded(parsePrefs(raw)));
  }, [store]);

  return <AlertPrefsContext.Provider value={store}>{children}</AlertPrefsContext.Provider>;
}

function useStore(): AlertPrefsStore {
  const store = useContext(AlertPrefsContext);
  if (!store) throw new Error("Alert preferences need an AlertPrefsProvider above them");
  return store;
}

// The prefs as they read now, and the way to change some.
export function useAlertPrefs(): [AlertPrefs, (change: Partial<AlertPrefs>) => void] {
  const store = useStore();
  return [useSyncExternalStore(store.subscribe, store.current), store.set];
}

// The prefs as they read when asked, for each banner as it arrives.
export function useAlertPrefsNow(): () => AlertPrefs {
  return useStore().current;
}

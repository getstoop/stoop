import * as Notifications from "expo-notifications";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAlertPrefs, useAlertPrefsNow } from "../alertPrefs/AlertPrefsProvider";
import { fetchWithoutCookies } from "../api/fetch";
import { deletePush, getPushConfig, registerPush, updatePush } from "../api/push";
import { sessionToken } from "../api/servers";
import { onAskedAndGranted } from "../notifications/permission";
import { useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { pushKeys } from ".";
import {
  apnsDeviceToken,
  apnsTarget,
  notificationsAllowed,
  pushRecords,
  pushSupported,
  relayUrl,
} from "./platform";
import { wantedKinds } from "./record";
import { subscribeAtRelay } from "./relay";
import { type PushServer, type PushSubscriber, pushSubscriber } from "./subscriber";

// Push registration for every saved server (subscriber.ts), at the root
// of the app inside the servers and the alert prefs, with nothing on
// screen. iOS only, and only in a build with a relay set; elsewhere it
// does nothing. Signing out of a server or removing it ends its
// subscription through usePushLeave.

const PushContext = createContext<PushSubscriber | null>(null);

export default function PushProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  const [prefs] = useAlertPrefs();
  const prefsNow = useAlertPrefsNow();
  const listed = useRef<PushServer[]>([]);
  listed.current = servers.map((server) => ({ id: server.id, origin: server.origin, session: server.session ?? 0 }));

  const [subscriber] = useState(() =>
    pushSubscriber({
      relayUrl: relayUrl(),
      supported: pushSupported,
      servers: () => listed.current,
      sessionToken,
      allowed: notificationsAllowed,
      deviceToken: apnsDeviceToken,
      target: apnsTarget,
      ensureKeys: pushKeys.ensure,
      removeKeys: pushKeys.remove,
      getConfig: getPushConfig,
      register: registerPush,
      update: updatePush,
      remove: deletePush,
      subscribe: (relay, request) => subscribeAtRelay(fetchWithoutCookies, relay, request, Date.now),
      records: pushRecords,
      kinds: (serverId) => wantedKinds(prefsNow(), serverId),
      now: Date.now,
      wait: (ms, done) => {
        const timer = setTimeout(done, ms);
        return () => clearTimeout(timer);
      },
      log: (line) => {
        if (__DEV__) console.info(line);
      },
    }),
  );

  // On return to the front, once the person allows notifications, and
  // when Apple hands the app a new device token.
  useEffect(() => {
    const foreground = AppState.addEventListener("change", (state) => state === "active" && subscriber.check());
    const granted = onAskedAndGranted(() => subscriber.check());
    const token = pushSupported
      ? Notifications.addPushTokenListener((next) => {
          if (typeof next.data === "string") subscriber.tokenSeen(next.data);
        })
      : null;
    return () => {
      foreground.remove();
      granted();
      token?.remove();
    };
  }, [subscriber]);

  // At launch, and when a server is signed in to, or signed in to again.
  const sessions = servers.map(sessionKey).join(" ");
  useEffect(() => {
    if (sessions) subscriber.check();
  }, [sessions, subscriber]);

  // When the kinds wanted change, as the Notifications screen sets them
  // or as the saved ones are read.
  const kinds = servers.map((server) => `${server.id}:${wantedKinds(prefs, server.id).join(",")}`).join(" ");
  useEffect(() => {
    if (kinds) subscriber.kindsChanged();
  }, [kinds, subscriber]);

  return <PushContext.Provider value={subscriber}>{children}</PushContext.Provider>;
}

// Ends a server's subscription as it is signed out of or removed: the
// server is asked to delete it (best effort) and the phone forgets its
// keys and record whatever the server said. Never rejects.
export function usePushLeave(): (server: PushServer, token: string | null) => Promise<void> {
  const subscriber = useContext(PushContext);
  if (!subscriber) throw new Error("Push needs a PushProvider above it");
  return subscriber.leave;
}

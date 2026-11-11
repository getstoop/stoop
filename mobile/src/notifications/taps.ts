import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import type { SavedServer } from "../servers";
import { acceptTap } from "./pendingTap";
import { tappedNotification } from "./tapped";

// Hears a notification being tapped, for as long as the app runs, and
// leaves it for the server layout to open (pendingTap.ts). A tap while
// the app runs arrives as an event; the one that launched the app came
// before anything listened, and is read from the library's "last
// response" instead. That is also set by every later tap, and either
// may be read again after a re-render or a return from the background,
// so each response is cleared from it as it is heard, and the store
// accepts one only once, by its key. Which responses count is
// tapped.ts.
export function useNotificationTaps(servers: SavedServer[]) {
  const saved = useRef(servers);
  saved.current = servers;
  useEffect(() => {
    const hear = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Left set, it is refused by its key should it be read again.
      }
      const tapped = tappedNotification(
        response,
        saved.current.map((server) => server.id),
        Notifications.DEFAULT_ACTION_IDENTIFIER,
      );
      if (tapped) acceptTap(tapped.key, tapped.data);
    };
    // Listening first, so no tap falls between the two.
    const heard = Notifications.addNotificationResponseReceivedListener(hear);
    try {
      hear(Notifications.getLastNotificationResponse());
    } catch {
      // No last response to read: only the launching tap is lost.
    }
    return () => heard.remove();
  }, []);
}

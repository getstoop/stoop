import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import type { SavedServer } from "../servers";
import { notificationData } from "./open";
import { acceptTap } from "./pendingTap";

// Hears a notification being tapped, for as long as the app runs, and
// leaves it for the server layout to open (pendingTap.ts). A tap while
// the app runs arrives as an event; the one that launched the app came
// before anything listened, and is read from the library's "last
// response" instead. That is also set by every later tap, so each
// response is cleared from it as it is heard, and the store takes one
// only once (its key: the notification's identifier and when it was
// shown, since a conversation's next notification reuses the
// identifier). A tap whose data isn't ours, or is for a server no
// longer saved, does nothing: the app has opened, and that is all.
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
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const { date, request } = response.notification;
      const data = notificationData(request.content.data);
      if (!data || !saved.current.some((server) => server.id === data.serverId)) return;
      acceptTap(`${request.identifier}@${date}`, data);
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

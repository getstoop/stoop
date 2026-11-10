import * as Notifications from "expo-notifications";
import { clears, type Read } from "./clear";
import { notificationData } from "./open";

// Takes out of the system's list the notifications a read clears
// (clear.ts), going by the data each was shown with. One that can't be
// listed or dismissed stays until it is tapped or swiped away.
export async function clearNotifications(read: Read): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter(({ request }) => {
          const data = notificationData(request.content.data);
          return data !== null && clears(read, data);
        })
        .map(({ request }) => Notifications.dismissNotificationAsync(request.identifier)),
    );
  } catch {
    // Nothing to do about it.
  }
}

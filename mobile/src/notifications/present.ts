import * as Notifications from "expo-notifications";
import { CHANNEL_ID, channelReady } from "./channel";
import type { NotificationContent } from "./content";

// Showing a notification through the system while the app is in front:
// a banner, a place in the notification list and the default sound. The
// app's icon badge is not set from here.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Presents at once; one with the same identifier replaces the last.
// Android reads the channel from the trigger (a null one would post to
// the library's fallback channel); iOS takes it as no trigger. Without
// the permission iOS rejects and Android drops it: the caller swallows
// both.
export async function present({ identifier, title, subtitle, body, data }: NotificationContent): Promise<void> {
  await channelReady();
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, subtitle, body, data, sound: "default" },
    trigger: { channelId: CHANNEL_ID },
  });
}

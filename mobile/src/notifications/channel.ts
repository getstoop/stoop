import * as Notifications from "expo-notifications";

// Android posts every notification to a channel, which the person can
// silence in the system's settings: the app has one, for everything it
// notifies of. It must exist before the system will show the permission
// prompt (Android 13 on), and before anything is posted to it. iOS has
// no channels, and the call does nothing there.

export const CHANNEL_ID = "activity";

let made: Promise<unknown> | undefined;

// Makes the channel once; a failure is tried again by the next caller.
export function channelReady(): Promise<unknown> {
  made ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Mentions and messages",
    importance: Notifications.AndroidImportance.HIGH,
  }).catch((err) => {
    made = undefined;
    throw err;
  });
  return made;
}

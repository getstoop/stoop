import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// The number on the app's icon, on iOS only. There the library sets it
// when the person allowed badges (asked for with the rest,
// permission.ts) and does nothing otherwise; 0 takes it off. On Android
// nothing is called: the library's count goes to the few launchers that
// draw one of their own (it fails on the rest, the stock one among
// them), and its 0 cancels every notification the app has showing.
// Android's launchers mark the icon themselves while a notification of
// the app's is in the list.

// One at a time, in the order asked, so the last asked is what stays.
let last: Promise<void> = Promise.resolve();

// A badge that can't be set is left as it was.
export function setIconBadge(count: number): Promise<void> {
  if (Platform.OS !== "ios") return Promise.resolve();
  last = last
    .then(() => Notifications.setBadgeCountAsync(count))
    .then(
      () => {},
      () => {},
    );
  return last;
}

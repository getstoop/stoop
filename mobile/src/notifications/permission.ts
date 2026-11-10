import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { channelReady } from "./channel";

// When the app asks to notify: once per run, as a signed-in server
// first shows, with the system's own prompt and nothing before it, and
// only while the person has not answered. Android never says
// "undetermined": before the first ask, and after one refusal, it says
// denied but askable, so there it asks while it still may, which the
// system allows twice.

let asked = false;

export async function askToNotifyOnce(): Promise<void> {
  if (asked) return;
  asked = true;
  try {
    await channelReady();
    const { status, granted, canAskAgain } = await Notifications.getPermissionsAsync();
    const unanswered = status === "undetermined" || (Platform.OS === "android" && !granted && canAskAgain);
    if (unanswered) await Notifications.requestPermissionsAsync();
  } catch {
    // Unasked is not granted: nothing shows, and the next run asks.
  }
}

export function useAskToNotify(ready: boolean) {
  useEffect(() => {
    if (ready) void askToNotifyOnce();
  }, [ready]);
}

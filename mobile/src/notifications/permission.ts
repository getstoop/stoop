import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { channelReady } from "./channel";
import { shouldAsk } from "./shouldAsk";

// When the app asks to notify: once per run, as a signed-in server
// first shows, with the system's own prompt and nothing before it, and
// only while the person has not answered (shouldAsk.ts).

let asked = false;

// Whether this run asked and was not granted, and who wants to know:
// Android still says askable after a first refusal (refused.ts).
let refusedThisRun = false;
const listeners = new Set<() => void>();

export function askedAndRefused(): boolean {
  return refusedThisRun;
}

export function onAskedAndRefused(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function askToNotifyOnce(): Promise<void> {
  if (asked) return;
  asked = true;
  try {
    await channelReady();
    if (!shouldAsk(await Notifications.getPermissionsAsync(), Platform.OS)) return;
    // The library's default: alerts, sounds and the badge, asked for
    // now so the app's icon badge needs no second prompt.
    const answer = await Notifications.requestPermissionsAsync();
    if (!answer.granted) {
      refusedThisRun = true;
      for (const listener of listeners) listener();
    }
  } catch {
    // Unasked is not granted: nothing shows, and the next run asks.
  }
}

export function useAskToNotify(ready: boolean) {
  useEffect(() => {
    if (ready) void askToNotifyOnce();
  }, [ready]);
}

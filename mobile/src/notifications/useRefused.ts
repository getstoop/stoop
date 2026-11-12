import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { askedAndRefused, onAskedAndRefused } from "./permission";
import { isRefused } from "./refused";

// Whether the person has refused notifications (refused.ts), read now
// and again as the app returns to the front, so coming back from the
// system's settings updates what shows. It never asks. Not refused
// until read, and when a read fails.
export function useRefused(): boolean {
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      Notifications.getPermissionsAsync()
        .then((permissions) => live && setRefused(isRefused(permissions, Platform.OS, askedAndRefused())))
        .catch(() => {});
    read();
    const sub = AppState.addEventListener("change", (state) => state === "active" && read());
    // An ask finishing while this is open.
    const off = onAskedAndRefused(read);
    return () => {
      live = false;
      sub.remove();
      off();
    };
  }, []);
  return refused;
}

import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { pushKeys } from ".";
import { useAlertPrefs, useAlertPrefsLoaded } from "../alertPrefs/AlertPrefsProvider";
import { useSpaceCounts } from "../alerts/AlertsProvider";
import { useServers } from "../servers";
import { mirrorWriter } from "./mirror";

// Keeps the notification service extension's copy of what words a push
// (mirror.ts) current: written as the app starts, whenever the hide
// text switch, the saved servers or a server's count of spaces change,
// and again as the app comes to the front, for a write the store
// refused. Nothing where push has no native module (Android).
export default function PushMirror() {
  const { servers } = useServers();
  const [{ showText }] = useAlertPrefs();
  const [prefsLoaded] = useAlertPrefsLoaded();
  const spaces = useSpaceCounts();
  const [writer] = useState(() => mirrorWriter(pushKeys.store));

  useEffect(() => {
    if (!pushKeys.supported) return;
    const write = () =>
      void writer.update({
        showText: prefsLoaded ? showText : undefined,
        servers,
        spaces: (serverId) => spaces.get(serverId),
      });
    write();
    const sub = AppState.addEventListener("change", (state) => state === "active" && write());
    return () => sub.remove();
  }, [writer, servers, showText, prefsLoaded, spaces]);

  return null;
}

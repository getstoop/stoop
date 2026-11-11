import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useWaitingEverywhere } from "../alerts/AlertsProvider";
import { setIconBadge } from "./badge";

// Keeps the app's icon badge at what waits on every saved server
// (src/alerts): set whenever that total changes, and once more as the
// app goes to the background, which catches a badge allowed only after
// the total last changed. Nothing updates it from there until the app
// is in front again: there is no push.
export default function AppIconBadge() {
  const count = useWaitingEverywhere();
  const latest = useRef(count);
  latest.current = count;

  useEffect(() => {
    setIconBadge(count);
  }, [count]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") setIconBadge(latest.current);
    });
    return () => sub.remove();
  }, []);

  return null;
}

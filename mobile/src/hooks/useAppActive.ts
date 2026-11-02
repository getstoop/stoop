import { useEffect, useState } from "react";
import { AppState } from "react-native";

// Whether the app is in the front. "inactive" (the app switcher, a system
// sheet) counts as not.
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

// How long after coming back to the app the socket's Ready may take
// before what it would load is loaded without it.
const READY_GRACE_MS = 3000;

// Loads on mounting, and on coming back from the background: that
// reopens the socket, whose Ready loads; should none come soon, it loads
// anyway. "inactive" is a moment between (the app switcher, a system
// sheet), after which nothing was missed. Hands back what to call when
// Ready comes, which drops the wait.
export function useLoadOnReturn(load: () => void): () => void {
  const due = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyCame = useCallback(() => {
    if (due.current) clearTimeout(due.current);
    due.current = null;
  }, []);
  useEffect(() => {
    load();
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (last === "background" && next === "active") {
        readyCame();
        due.current = setTimeout(() => {
          due.current = null;
          load();
        }, READY_GRACE_MS);
      }
      last = next;
    });
    return () => {
      sub.remove();
      readyCame();
    };
  }, [load, readyCame]);
  return readyCame;
}

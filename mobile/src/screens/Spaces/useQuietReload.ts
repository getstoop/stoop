import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { awayChanges } from "./reloads";

const RELOAD_DELAY_MS = 300;

// Reloads for what the realtime socket and the app coming back say
// changed, while the Spaces tab is in sight. Events come in bursts (a
// channel deleted is also its messages' reads and mentions gone), so
// `soon` lets a moment's quiet go before one reload; `now` reloads at
// once. Out of sight (under a pushed channel, behind another tab) both
// only remember that something changed, and the tab reloads once when
// it is in sight again (./reloads.ts). `cancel` drops a reload asked
// for; leaving the screen drops it too.
export function useQuietReload(reload: () => void): { soon: () => void; now: () => void; cancel: () => void } {
  const focused = useIsFocused();
  const [away] = useState(awayChanges);
  const latest = useRef({ reload, focused });
  latest.current = { reload, focused };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (focused && away.returned()) latest.current.reload();
  }, [focused, away]);

  return useMemo(() => {
    // Asked again as the moment ends: the tab may have gone out of
    // sight since.
    const now = () => {
      if (away.changed(latest.current.focused) === "reload") latest.current.reload();
    };
    return {
      soon: () => {
        clearTimeout(timer.current);
        if (away.changed(latest.current.focused) === "reload") timer.current = setTimeout(now, RELOAD_DELAY_MS);
      },
      now,
      cancel: () => clearTimeout(timer.current),
    };
  }, [away]);
}

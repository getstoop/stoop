import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

// A screen pushed over this one (a thread, the search, a channel from
// a result), one at a time: a second tap before the first has covered
// this screen pushes nothing; coming back to it lets the next go, as
// does a second gone by, should the push have gone nowhere.
export function usePushOnce(): (go: () => void) => void {
  const focused = useIsFocused();
  const pushed = useRef(false);
  useEffect(() => {
    if (focused) pushed.current = false;
  }, [focused]);
  return useCallback((go: () => void) => {
    if (pushed.current) return;
    pushed.current = true;
    setTimeout(() => {
      pushed.current = false;
    }, 1000);
    go();
  }, []);
}

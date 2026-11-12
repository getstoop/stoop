import { useEffect, useMemo, useRef } from "react";

const RELOAD_DELAY_MS = 300;

// Events come in bursts (a channel deleted is also its messages' reads
// and mentions gone), so a moment's quiet goes before one reload.
// `soon` asks for one, `cancel` drops one asked for; leaving the screen
// drops it too.
export function useQuietReload(reload: () => void): { soon: () => void; cancel: () => void } {
  const latest = useRef(reload);
  latest.current = reload;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(
    () => ({
      soon: () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => latest.current(), RELOAD_DELAY_MS);
      },
      cancel: () => clearTimeout(timer.current),
    }),
    [],
  );
}

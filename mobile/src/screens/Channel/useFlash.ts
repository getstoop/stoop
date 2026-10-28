import { useCallback, useEffect, useRef, useState } from "react";

// How long the row a jump landed on wears its ring.
const FLASH_MS = 1500;

// The row a jump landed on, ringed in the accent for a moment so the
// reader's eye finds it (MessageRow `target` "focus"), in the channel and
// the thread. A second flash replaces the first; leaving the screen ends
// it.
export function useFlash() {
  const [flashId, setFlashId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFlashId(id);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFlashId(null);
    }, FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { flashId, flash };
}

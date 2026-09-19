import { useEffect, useState } from "react";

// A clock that ticks every second, so "3s ago" keeps counting between
// refetches.
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

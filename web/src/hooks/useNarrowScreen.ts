import { useEffect, useState } from "react";

// The same breakpoint as styles/mobile.css: a phone, or any window too
// short to hold the desktop layout.
export const NARROW_SCREEN = "(max-width: 768px), (max-height: 480px)";

export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(NARROW_SCREEN).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW_SCREEN);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

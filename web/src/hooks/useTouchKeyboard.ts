import { useEffect, useState } from "react";

// A device typed on with an on-screen keyboard: no hover, a finger for a
// pointer. Its Return key breaks the line, so sending needs a button.
const TOUCH_KEYBOARD = "(hover: none) and (pointer: coarse)";

export function useTouchKeyboard(): boolean {
  const [touch, setTouch] = useState(
    () =>
      typeof matchMedia === "function" && matchMedia(TOUCH_KEYBOARD).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(TOUCH_KEYBOARD);
    const update = () => setTouch(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return touch;
}

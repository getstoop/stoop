import type { ReactNode } from "react";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";

// What shows only while the keyboard is down. It watches the keyboard
// itself, so nothing around it is drawn again as the keyboard comes and
// goes.
export default function KeyboardDown({ children }: { children: ReactNode }) {
  return useKeyboardHeight() === 0 ? children : null;
}

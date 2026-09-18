import { useEffect, useRef } from "react";
import {
  isTypingTarget,
  matchShortcut,
  type ShortcutId,
} from "../api/shortcuts";

const handlers = new Map<ShortcutId, () => void>();

// The component that owns the action registers it while mounted; a
// binding nobody holds does nothing and the key passes through.
export function useShortcut(id: ShortcutId, handler: () => void, on = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!on) return;
    const run = () => latest.current();
    handlers.set(id, run);
    return () => {
      if (handlers.get(id) === run) handlers.delete(id);
    };
  }, [id, on]);
}

// The app's one global keydown listener, mounted once at the root.
export function useShortcutListener() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      const id = matchShortcut(e, isTypingTarget(e.target as HTMLElement));
      const run = id && handlers.get(id);
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

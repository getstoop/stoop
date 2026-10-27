// The formats the toolbar and the keyboard shortcuts apply
// (core/editor/formats). The editor carries them out
// (components/RichEditor/commands.ts).

import type { Format } from "../core/editor/formats";

export type { Format };

// ⌘/Ctrl+B, I, U, E (code) and ⌘/Ctrl+Shift+X (strike).
export function shortcutFormat(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): Format | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "x" ? "strike" : null;
  switch (k) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "u":
      return "underline";
    case "e":
      return "code";
    default:
      return null;
  }
}

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutHint(keys: string): string {
  return IS_MAC ? `⌘${keys}` : `Ctrl+${keys}`;
}

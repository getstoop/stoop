// Every app-wide key binding, declared here and nowhere else
// (docs/architecture/web.md → Keyboard shortcuts). Keys a field owns
// while it has focus stay with the field.

export type ShortcutId = "toggleMute" | "toggleDeafen" | "stageFullscreen";

export interface Binding {
  // KeyboardEvent.key, lower case.
  key: string;
  // Cmd or Ctrl.
  mod?: boolean;
  shift?: boolean;
  // Fires while a text field has focus. Only for bindings with a modifier.
  whileTyping?: boolean;
}

export const BINDINGS: Record<ShortcutId, Binding> = {
  toggleMute: { key: "m", mod: true, shift: true, whileTyping: true },
  toggleDeafen: { key: "d", mod: true, shift: true, whileTyping: true },
  stageFullscreen: { key: "f" },
};

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// The one answer to "is the user typing right now?".
export function isTypingTarget(
  target: {
    tagName?: string;
    isContentEditable?: boolean;
  } | null,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "");
}

export function matchShortcut(e: KeyPress, typing: boolean): ShortcutId | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  for (const id of Object.keys(BINDINGS) as ShortcutId[]) {
    const b = BINDINGS[id];
    if (b.key !== key || !!b.mod !== mod || !!b.shift !== e.shiftKey) continue;
    if (typing && !b.whileTyping) continue;
    return id;
  }
  return null;
}

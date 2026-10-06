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

// Push to talk is held, not pressed, so it is not in BINDINGS: the hold
// is watched on keydown and keyup by usePushToTalk. It is the physical
// key above Tab (KeyboardEvent.code), whatever that key types on this
// layout. Ctrl on every platform: Cmd+` is macOS's own "next window".
// With a modifier it types nothing, so it works while typing too.
export const PUSH_TO_TALK_LABEL = "Ctrl+`";

export interface KeyHold {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export function isPushToTalkPress(e: KeyHold): boolean {
  return e.code === "Backquote" && e.ctrlKey && !e.metaKey && !e.altKey;
}

// Letting go of either half ends the hold.
export function isPushToTalkRelease(e: KeyHold): boolean {
  return e.code === "Backquote" || e.key === "Control";
}

// The seam between the web app and whatever is hosting it. In a browser
// or an installed PWA there is nothing behind it. The desktop shell
// injects window.stoop from its preload script, and the app feature-
// detects that object — never the user agent. Absent bridge means a
// browser. docs/architecture/desktop.md.

// The contract level this app speaks. Bump together with
// internal/webui/bridge.go whenever StoopBridge changes.
export const BRIDGE = 1;

export type ShortcutName = "pushToTalk";

export interface StoopBridge {
  bridge: number;
  version: string;
  platform: "darwin" | "win32" | "linux";
  // The unread total for this server; the shell sums across servers.
  setBadge(count: number): void;
  // Global shortcuts the shell captured while the window was not
  // focused. Returns the unsubscribe.
  onShortcut(name: ShortcutName, handler: (down: boolean) => void): () => void;
}

declare global {
  interface Window {
    stoop?: StoopBridge;
  }
}

export function bridge(): StoopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.stoop;
}

export function isDesktop(): boolean {
  return bridge() !== undefined;
}

export function setBadge(count: number) {
  bridge()?.setBadge(count);
}

export function onShortcut(
  name: ShortcutName,
  handler: (down: boolean) => void,
): () => void {
  return bridge()?.onShortcut(name, handler) ?? (() => {});
}

// The seam between the web app and whatever is hosting it. In a browser
// or an installed PWA there is nothing behind it. The desktop shell
// injects window.stoop from its preload script, and the app feature-
// detects that object — never the user agent. Absent bridge means a
// browser. docs/architecture/desktop.md.

// The contract level this app speaks. Bump together with
// internal/webui/bridge.go whenever StoopBridge changes.
export const BRIDGE = 2;

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
  // Bridge 2. The theme the shell wears, whole: the shell chooses it in
  // its own settings and hands it to every server page, so the app
  // paints from the tokens and hides its own picker. Optional here
  // because a bridge-1 shell has neither, and the app then keeps its
  // own choice as a browser does.
  theme?: ShellTheme;
  onTheme?(handler: (theme: ShellTheme) => void): () => void;
}

// The shape of a theme, as the shell hands it over: no name, only what
// it is made of — every token of themes.css by its CSS name, applied as
// it is. A theme this build has never heard of renders the same as one
// it has.
export interface ShellTheme {
  scheme: "dark" | "light";
  tokens: Record<string, string>;
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

// The theme the shell is wearing, or undefined outside a shell that
// owns the theme (a browser, a PWA, a bridge-1 shell).
export function shellTheme(): ShellTheme | undefined {
  const theme = bridge()?.theme;
  return theme && typeof theme === "object" ? theme : undefined;
}

export function onShellTheme(handler: (theme: ShellTheme) => void): () => void {
  return bridge()?.onTheme?.(handler) ?? (() => {});
}

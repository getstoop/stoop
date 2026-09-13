// The seam between the web app and whatever is hosting it. In a browser
// or an installed PWA there is nothing behind it. The desktop shell
// injects window.stoop from its preload script, and the app feature-
// detects that object — never the user agent. Absent bridge means a
// browser. docs/architecture/desktop.md.

// The contract level this app speaks. Bump together with
// internal/webui/bridge.go whenever StoopBridge changes.
export const BRIDGE = 2;

export type ShortcutName = "pushToTalk";

// Bridge 3. How the shell names a status, so the contract does not
// depend on the realtime protos the shell has no copy of. The page maps
// them to PresenceStatus on the way in.
export type PresenceChoice = "online" | "away" | "dnd";

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
  // Bridge 3. The status is the app's, not the server's: the shell keeps
  // one choice and hands it to every server page it holds, so a person is
  // away everywhere or nowhere. Optional for the same reason the theme
  // is: a bridge-2 shell has neither, and the app then decides for
  // itself as a browser does.
  status?: PresenceChoice;
  onStatus?(handler: (status: PresenceChoice) => void): () => void;
  // Bridge 3. Whether App settings is letting desktop banners through —
  // off there silences them for every server at once. A function rather
  // than a value because the answer changes while the page is open and
  // the bridge copies values across once, at load; it is asked at the
  // moment a banner would fire.
  notificationsAllowed?(): boolean;
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

// The status the shell is keeping for every server, or undefined when
// nothing is keeping one — a browser, a PWA, or a shell older than
// bridge 3. Whoever gets undefined owns the choice themselves, so this
// is also what decides whether the page offers a status control at all.
export function shellStatus(): PresenceChoice | undefined {
  const status = bridge()?.status;
  return status === "online" || status === "away" || status === "dnd"
    ? status
    : undefined;
}

export function onShellStatus(
  handler: (status: PresenceChoice) => void,
): () => void {
  return bridge()?.onStatus?.(handler) ?? (() => {});
}

// Whether the shell is letting desktop banners through, right now. True
// everywhere that cannot say: a browser answers for itself through the
// Notification permission, and a shell too old to have the switch is not
// saying no.
export function shellNotifications(): boolean {
  return bridge()?.notificationsAllowed?.() ?? true;
}

import { create } from "zustand";
import { onShellTheme, type ShellTheme, shellTheme } from "./platform";

// Themes are a client-side choice: the preference lives in localStorage
// (never on the server, never set by a space or an admin) and is stamped
// on <html data-theme> — by index.html before React mounts, so there is
// no flash of the wrong theme, and by this module whenever it changes.
// "Follow system" is a preference, not a theme: it picks one of the
// person's chosen dark/light pair by prefers-color-scheme.
//
// Inside the desktop shell the choice is the shell's, made once for
// every server in its App settings: the page paints from the tokens the
// shell hands it, repaints as they change, and hides its own picker
// (docs/architecture/desktop.md). index.html does the same before
// React mounts, so the two must stay in step.

export type ThemeId =
  | "brownstone"
  | "daylight"
  | "dusk"
  | "bodega"
  | "newsprint"
  | "blackout"
  | "fire-escape"
  | "nightcap"
  | "night-bus"
  | "mailbox";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  kind: "dark" | "light";
  blurb: string;
}

export const THEMES: ThemeInfo[] = [
  {
    id: "brownstone",
    name: "Brownstone",
    kind: "dark",
    blurb: "Charcoal and terracotta. The original.",
  },
  {
    id: "daylight",
    name: "Daylight",
    kind: "light",
    blurb: "Warm paper, the same terracotta.",
  },
  {
    id: "dusk",
    name: "Dusk",
    kind: "dark",
    blurb: "Ink violet, streetlight amber.",
  },
  {
    id: "bodega",
    name: "Bodega",
    kind: "dark",
    blurb: "Bottle green, mustard awning.",
  },
  {
    id: "newsprint",
    name: "Newsprint",
    kind: "light",
    blurb: "Cool paper, steel. Tool, not hangout.",
  },
  {
    id: "blackout",
    name: "Blackout",
    kind: "dark",
    blurb: "True black, high contrast.",
  },
  {
    id: "fire-escape",
    name: "Fire Escape",
    kind: "dark",
    blurb: "Charcoal, painted-iron blue.",
  },
  {
    id: "nightcap",
    name: "Nightcap",
    kind: "dark",
    blurb: "Espresso and cream, dusty rose.",
  },
  {
    id: "night-bus",
    name: "Night Bus",
    kind: "dark",
    blurb: "Indigo windows, lilac rail.",
  },
  {
    id: "mailbox",
    name: "Mailbox",
    kind: "dark",
    blurb: "Postal blue, chalk lettering.",
  },
];

export interface ThemePreference {
  mode: "theme" | "system";
  theme: ThemeId;
  dark: ThemeId;
  light: ThemeId;
}

export const THEME_STORAGE_KEY = "stoop.theme";

// Every token a theme is made of, as themes.css names them. A shell
// theme is applied token by token, and only these; anything else it
// sends is ignored.
export const TOKEN_NAMES = [
  "--canvas",
  "--surface",
  "--panel",
  "--raised",
  "--hover",
  "--border",
  "--text",
  "--text-muted",
  "--accent",
  "--accent-soft",
  "--on-accent",
  "--ok",
  "--warn",
  "--danger",
  "--shadow",
  "--scrim",
] as const;

const DEFAULT: ThemePreference = {
  mode: "theme",
  theme: "brownstone",
  dark: "brownstone",
  light: "daylight",
};

const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

function load(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<ThemePreference>;
    return {
      mode: p.mode === "system" ? "system" : "theme",
      theme: isTheme(p.theme) ? p.theme : DEFAULT.theme,
      dark: isTheme(p.dark) ? p.dark : DEFAULT.dark,
      light: isTheme(p.light) ? p.light : DEFAULT.light,
    };
  } catch {
    return DEFAULT;
  }
}

const systemDark = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-color-scheme: dark)").matches;

// The theme a preference resolves to right now.
export function resolveTheme(p: ThemePreference): ThemeId {
  if (p.mode === "system") return systemDark() ? p.dark : p.light;
  return p.theme;
}

function stamp(p: ThemePreference) {
  stampId(resolveTheme(p));
}

function stampId(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  themeColor();
}

// The browser chrome that follows theme-color (an installed app's
// title bar, the desktop shell's window) takes the rail's colour.
function themeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--canvas")
    .trim();
  if (meta && canvas) meta.setAttribute("content", canvas);
}

// Wears a theme the shell handed over: every token on the root as it
// is, over the bare default. No theme of ours is named or stamped; a
// token the shell did not send takes the default's value.
function wearShell(theme: ShellTheme) {
  const root = document.documentElement;
  delete root.dataset.theme;
  const tokens = theme.tokens ?? {};
  for (const name of TOKEN_NAMES) {
    const value = tokens[name];
    if (typeof value === "string") root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.style.colorScheme = theme.scheme === "light" ? "light" : "dark";
  themeColor();
  useThemeStore.setState({ shell: true });
}

interface ThemeState {
  pref: ThemePreference;
  active: ThemeId;
  // The desktop shell chose the theme; the picker is hidden.
  shell: boolean;
  setPref: (p: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  pref: DEFAULT,
  active: DEFAULT.theme,
  shell: false,
  setPref: (pref) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(pref));
    } catch {
      // Private mode or storage disabled: the choice lasts for this page.
    }
    stamp(pref);
    set({ pref, active: resolveTheme(pref) });
  },
}));

// Read the saved preference, stamp it, and follow the OS while in system
// mode. Called once at startup. In a shell that owns the theme, wear
// the shell's instead, now and whenever it changes.
export function initTheme() {
  const fromShell = shellTheme();
  if (fromShell !== undefined) {
    wearShell(fromShell);
    onShellTheme(wearShell);
    return;
  }
  const pref = load();
  stamp(pref);
  useThemeStore.setState({ pref, active: resolveTheme(pref) });
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      () => {
        const { pref } = useThemeStore.getState();
        if (pref.mode !== "system") return;
        stamp(pref);
        useThemeStore.setState({ active: resolveTheme(pref) });
      },
    );
  }
}

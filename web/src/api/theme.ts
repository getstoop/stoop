import { create } from "zustand";

// Themes are a client-side choice: the preference lives in localStorage
// (never on the server, never set by a space or an admin) and is stamped
// on <html data-theme> — by index.html before React mounts, so there is
// no flash of the wrong theme, and by this module whenever it changes.
// "Follow system" is a preference, not a theme: it picks one of the
// person's chosen dark/light pair by prefers-color-scheme.

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
  document.documentElement.dataset.theme = resolveTheme(p);
}

interface ThemeState {
  pref: ThemePreference;
  active: ThemeId;
  setPref: (p: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  pref: DEFAULT,
  active: DEFAULT.theme,
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
// mode. Called once at startup.
export function initTheme() {
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

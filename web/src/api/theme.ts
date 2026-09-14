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
  | "mailbox"
  | "subway-tile"
  | "pigeon"
  | "laundromat"
  | "boardwalk"
  | "whiteout"
  | "library"
  | "ginkgo"
  | "rooftop"
  | "water-tower"
  | "streetlight"
  | "neon"
  | "ferry"
  | "bike-lane"
  | "crosswalk"
  | "concrete"
  | "scaffolding"
  | "sidewalk-chalk";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  // The half of the Follow-system pair this theme can be; dim themes are
  // dark here.
  kind: "dark" | "light";
  // What the picker files it under and prints on its card.
  tier: "light" | "dim" | "dark";
  // Extra picker filters it also answers to.
  tags?: ThemeTag[];
  blurb: string;
  // Why it carries the "accessible" tag; shown under the card in that filter.
  why?: string;
}

export type ThemeTag = "accessible";
export type ThemeFilter = ThemeInfo["tier"] | ThemeTag | "all";

export const THEME_FILTERS: { id: ThemeFilter; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dim", label: "Dim" },
  { id: "dark", label: "Dark" },
  { id: "accessible", label: "Accessible" },
  { id: "all", label: "All" },
];

export const matchesFilter = (t: ThemeInfo, f: ThemeFilter): boolean =>
  f === "all" || t.tier === f || (t.tags ?? []).includes(f as ThemeTag);

export const THEMES: ThemeInfo[] = [
  {
    id: "brownstone",
    name: "Brownstone",
    kind: "dark",
    tier: "dark",
    blurb: "Charcoal and terracotta. The original.",
  },
  {
    id: "daylight",
    name: "Daylight",
    kind: "light",
    tier: "light",
    blurb: "Warm paper, the same terracotta.",
  },
  {
    id: "dusk",
    name: "Dusk",
    kind: "dark",
    tier: "dark",
    blurb: "Ink violet, streetlight amber.",
  },
  {
    id: "bodega",
    name: "Bodega",
    kind: "dark",
    tier: "dark",
    blurb: "Bottle green, mustard awning.",
  },
  {
    id: "newsprint",
    name: "Newsprint",
    kind: "light",
    tier: "light",
    blurb: "Cool paper, steel. Tool, not hangout.",
  },
  {
    id: "blackout",
    name: "Blackout",
    kind: "dark",
    tier: "dark",
    tags: ["accessible"],
    blurb: "True black, high contrast.",
    why: "Highest contrast on a dark ground.",
  },
  {
    id: "fire-escape",
    name: "Fire Escape",
    kind: "dark",
    tier: "dark",
    blurb: "Charcoal, painted-iron blue.",
  },
  {
    id: "nightcap",
    name: "Nightcap",
    kind: "dark",
    tier: "dark",
    blurb: "Espresso and cream, dusty rose.",
  },
  {
    id: "night-bus",
    name: "Night Bus",
    kind: "dark",
    tier: "dark",
    blurb: "Indigo windows, lilac rail.",
  },
  {
    id: "mailbox",
    name: "Mailbox",
    kind: "dark",
    tier: "dark",
    blurb: "Postal blue, chalk lettering.",
  },
  {
    id: "subway-tile",
    name: "Subway Tile",
    kind: "light",
    tier: "light",
    blurb: "White tile, grout, enamel green.",
  },
  {
    id: "pigeon",
    name: "Pigeon",
    kind: "light",
    tier: "light",
    blurb: "Feather grey, iridescent violet.",
  },
  {
    id: "laundromat",
    name: "Laundromat",
    kind: "light",
    tier: "light",
    blurb: "Fluorescent white, mint machines, raspberry.",
  },
  {
    id: "boardwalk",
    name: "Boardwalk",
    kind: "light",
    tier: "light",
    blurb: "Sand, weathered planks, the Atlantic.",
  },
  {
    id: "whiteout",
    name: "Whiteout",
    kind: "light",
    tier: "light",
    tags: ["accessible"],
    blurb: "Pure white, pure black, cobalt.",
    why: "Highest contrast on a light ground.",
  },
  {
    id: "library",
    name: "Library",
    kind: "light",
    tier: "light",
    tags: ["accessible"],
    blurb: "Oak, parchment, a green-shaded lamp.",
    why: "Lower glare: text near 8:1 instead of 15:1.",
  },
  {
    id: "ginkgo",
    name: "Ginkgo",
    kind: "light",
    tier: "light",
    blurb: "November sidewalk, gold leaves.",
  },
  {
    id: "rooftop",
    name: "Rooftop",
    kind: "dark",
    tier: "dim",
    blurb: "Slate at dusk, a peach horizon.",
  },
  {
    id: "water-tower",
    name: "Water Tower",
    kind: "dark",
    tier: "dim",
    blurb: "Cedar planks, galvanized steel, sky.",
  },
  {
    id: "streetlight",
    name: "Streetlight",
    kind: "dark",
    tier: "dark",
    blurb: "Sodium amber on a warm black.",
  },
  {
    id: "neon",
    name: "Neon",
    kind: "dark",
    tier: "dark",
    blurb: "Open 24 hours. Magenta tube, cyan tube.",
  },
  {
    id: "ferry",
    name: "Ferry",
    kind: "dark",
    tier: "dark",
    blurb: "Harbor at night, that orange boat.",
  },
  {
    id: "bike-lane",
    name: "Bike Lane",
    kind: "dark",
    tier: "dark",
    blurb: "Asphalt, thermoplastic white, painted green.",
  },
  {
    id: "crosswalk",
    name: "Crosswalk",
    kind: "dark",
    tier: "dark",
    tags: ["accessible"],
    blurb: "Asphalt, painted stripes, safe signals.",
    why: "Status colours stay apart under red-green colour blindness.",
  },
  {
    id: "concrete",
    name: "Concrete",
    kind: "dark",
    tier: "dark",
    tags: ["accessible"],
    blurb: "Grey on grey. Colour only where it means something.",
    why: "No tint anywhere; colour only where it means something.",
  },
  {
    id: "scaffolding",
    name: "Scaffolding",
    kind: "dark",
    tier: "dim",
    blurb: "Sidewalk shed green, safety orange.",
  },
  {
    id: "sidewalk-chalk",
    name: "Sidewalk Chalk",
    kind: "dark",
    tier: "dim",
    blurb: "Warm concrete, chalk pastels.",
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

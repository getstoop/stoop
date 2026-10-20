import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import { themes } from "./generated";

export type ThemeName = keyof typeof themes;
export type Theme = (typeof themes)[ThemeName];

type ThemeState = {
  name: ThemeName;
  theme: Theme;
  setName: (name: ThemeName) => void;
};

export const ThemeContext = createContext<ThemeState | null>(null);

// The choice is this phone's, as on web (where it lives in the browser,
// never on a server): one theme for every server added here. It is kept
// in the keychain, the app's only store so far, beside the server list.
const KEY = "theme";
const DEFAULT: ThemeName = "brownstone";

const isThemeName = (name: string | null): name is ThemeName => !!name && name in themes;

// Holds the app's theme and draws the status bar to match it. Brownstone,
// the web app's default, until someone picks another. Nothing under it
// renders until the saved choice is read, so the app never opens in the
// wrong theme and then repaints.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState<ThemeName | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .catch(() => null)
      .then((saved) => setNameState(isThemeName(saved) ? saved : DEFAULT));
  }, []);

  // Applies at once; the save follows, and a failed one only means the
  // next launch opens in the theme before.
  const setName = useCallback((next: ThemeName) => {
    setNameState(next);
    SecureStore.setItemAsync(KEY, next).catch(() => {});
  }, []);

  const state = useMemo(
    () => (name ? { name, theme: themes[name], setName } : null),
    [name, setName],
  );

  // Tells the system whether the app is light or dark, as the theme is,
  // so what the system draws (the tab bar's Liquid Glass, headers,
  // keyboards) matches it rather than the phone's own setting.
  const scheme = state?.theme.scheme;
  useEffect(() => {
    if (scheme) Appearance.setColorScheme(scheme);
  }, [scheme]);

  if (!state) return null;
  return (
    <ThemeContext.Provider value={state}>
      {children}
      <StatusBar style={state.theme.scheme === "dark" ? "light" : "dark"} />
    </ThemeContext.Provider>
  );
}

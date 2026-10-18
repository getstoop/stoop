import { useContext } from "react";
import { tokens } from "./generated";
import ThemeProvider, { type Theme, ThemeContext, type ThemeName } from "./ThemeProvider";

export { ThemeProvider, tokens };
export type { Theme, ThemeName };

function useThemeState() {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider above it");
  return state;
}

// The current theme's colours, for a screen's styles.
export function useTheme(): Theme {
  return useThemeState().theme;
}

// The current theme's name and a way to change it, for a theme picker.
export function useThemeName(): [ThemeName, (name: ThemeName) => void] {
  const { name, setName } = useThemeState();
  return [name, setName];
}

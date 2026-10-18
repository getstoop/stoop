import { StatusBar } from "expo-status-bar";
import { createContext, type ReactNode, useMemo, useState } from "react";
import { themes } from "./generated";

export type ThemeName = keyof typeof themes;
export type Theme = (typeof themes)[ThemeName];

type ThemeState = {
  name: ThemeName;
  theme: Theme;
  setName: (name: ThemeName) => void;
};

export const ThemeContext = createContext<ThemeState | null>(null);

// Holds the app's theme and draws the status bar to match it. Brownstone,
// the web app's default, until someone picks another; nothing offers a
// choice yet, and the choice is not saved across launches.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>("brownstone");
  const state = useMemo(() => ({ name, theme: themes[name], setName }), [name]);

  return (
    <ThemeContext.Provider value={state}>
      {children}
      <StatusBar style={state.theme.scheme === "dark" ? "light" : "dark"} />
    </ThemeContext.Provider>
  );
}

import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import { THEMES } from "../src/api/theme";
import "../src/themes.css";
import "../src/styles/index.css";
import "../src/styles/kit.css";

const GROUNDS = ["surface", "panel", "canvas"] as const;

// The toolbar's theme goes where the app puts it, on the root element, so
// every sheet resolves as it does in the app. The ground is what the story
// sits on: a field is a hole in a panel and should be judged on one.
const withTheme: Decorator = (Story, { globals }) => {
  useEffect(() => {
    document.documentElement.dataset.theme = globals.theme;
    document.body.dataset.ground = globals.ground;
  }, [globals.theme, globals.ground]);
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        icon: "paintbrush",
        dynamicTitle: true,
        items: THEMES.map((t) => ({ value: t.id, title: t.name })),
      },
    },
    ground: {
      description: "Ground",
      toolbar: {
        icon: "square",
        dynamicTitle: true,
        items: GROUNDS.map((g) => ({ value: g, title: `--${g}` })),
      },
    },
  },
  initialGlobals: { theme: THEMES[0].id, ground: "surface" },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "todo" },
  },
};

export default preview;

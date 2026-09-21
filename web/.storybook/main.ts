import type { StorybookConfig } from "@storybook/react-vite";

// The kit workspace: docs/architecture/design-system.md → What holds it.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  // The TypeScript-program docgen is unproven against TypeScript 7.
  typescript: { reactDocgen: "react-docgen" },
  core: { disableTelemetry: true },
};

export default config;

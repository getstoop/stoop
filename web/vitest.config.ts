import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic the browser suite should not have to
// reach: the Markdown parser, shortcodes, member grouping. None of it
// touches the DOM, so the node environment is enough and there is no
// jsdom dependency. See docs/agent-workflow.md → Tests.
//
// The phone app's pure logic is tested here too (mobile/ has no runner of
// its own): files that need no React Native, with the app's @stoop/*
// paths pointed at the same web folders its tsconfig maps them to. Every
// file compiles under web's tsconfig: the app's extends Expo's, which
// only the app's own tools can find.
export default defineConfig({
  oxc: {
    tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)),
  },
  resolve: {
    alias: {
      "@stoop/core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@stoop/gen": fileURLToPath(new URL("./src/gen", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "../mobile/src/**/*.test.ts"],
  },
});

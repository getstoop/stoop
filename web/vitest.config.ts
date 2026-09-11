import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic the browser suite should not have to
// reach: the Markdown parser, shortcodes, member grouping. None of it
// touches the DOM, so the node environment is enough and there is no
// jsdom dependency. See docs/agent-workflow.md → Tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

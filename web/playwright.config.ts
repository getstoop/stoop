import { defineConfig } from "@playwright/test";

// Spike (STOOP-228): one spec ported from web/e2e to measure what
// Playwright's actionability and web-first assertions actually buy.
// Deliberately mirrors the puppeteer runner's shape — one worker, no
// retries — so the comparison is like for like.
export default defineConfig({
  testDir: "./e2e-pw",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.STOOP_E2E_BASE_URL ?? "http://localhost:8091",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

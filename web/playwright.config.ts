import { defineConfig } from "@playwright/test";

// The browser suite is migrating here from web/e2e (STOOP-238). Both run
// in CI against the same server until the last spec has moved; a spec
// lives in exactly one of them, never both.
//
// One worker, no retries — deliberately. Retries turn a visible flake
// into an invisible one, which is the bug STOOP-218 existed to fix.
export default defineConfig({
  testDir: "./e2e-pw",
  // A test that is going to fail should say so quickly. actionTimeout also
  // bounds bare locator.waitFor() barriers, which otherwise inherit the
  // whole test timeout and stall two minutes apiece on CI.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.STOOP_E2E_BASE_URL ?? "http://localhost:8091",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

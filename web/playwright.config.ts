import { defineConfig } from "@playwright/test";

// The browser suite (STOOP-238). web/e2e is gone apart from its shared
// seed.mjs, which both this and nothing else now use.
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
    // Fake media for the voice spec. Set for every spec rather than in a
    // project of its own: they only change what getUserMedia and
    // getDisplayMedia hand back, which nothing else asks for, and one
    // browser profile is less machinery than a project split.
    launchOptions: {
      args: [
        // Keep every page running at full rate. A spec with two or three
        // pages has only one at the front, and Chromium throttles the
        // rest: requestAnimationFrame stalls, which is what draws the
        // speaking ring in voice, and timers slow down. Without these a
        // spec passes alone and fails in the suite, which reads as a
        // flake rather than as the harness backgrounding a page.
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        // Screen share without a picker: Chrome hands over a fake screen.
        "--auto-select-desktop-capture-source=Entire screen",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

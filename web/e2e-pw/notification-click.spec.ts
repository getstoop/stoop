import { expect, hasVoice, seed, sendMessage, signIn, test } from "./lib";

declare global {
  interface Window {
    __banners: { onclick: (() => void) | null }[];
    __samePage?: boolean;
  }
}

// Clicking a desktop banner goes where it points without leaving the
// page: a voice call lives in the page, so a banner that loaded a new
// one ended the call. Needs LiveKit, and skips itself without it.
test("a banner click keeps the voice call", async ({ browser, request }) => {
  test.skip(
    !(await hasVoice(request)),
    "no LiveKit on this instance (make dev-services)",
  );
  const { suffix, tokens, ids, channels } = await seed();

  // Headless Chrome can't show native notifications; stub the API and keep
  // each banner, so the spec can click one the way the system would.
  const context = await browser.newContext({
    permissions: ["notifications", "microphone"],
  });
  await context.addInitScript(() => {
    window.__banners = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission() {
        return Promise.resolve("granted");
      }
      onclick: (() => void) | null = null;
      constructor() {
        window.__banners.push(this);
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification });
  });
  const A = await context.newPage();
  await signIn(A, tokens.ada);

  // A makes a voice channel and joins it, which opens its view.
  await A.locator(".channel-add.voice").click();
  await A.getByLabel("Voice channel name").fill("lounge");
  await A.getByRole("button", { name: "Create", exact: true }).click();
  await A.locator(".voice-channel .channel-link.voice").click();
  const bar = A.locator(".voice-bar strong");
  await expect(bar, "A connects to voice").toHaveText("Voice connected", {
    timeout: 15_000,
  });

  // A mark on the page itself: a reload would take it away.
  await A.evaluate(() => {
    window.__samePage = true;
  });

  // B mentions A in #general, and A clicks the banner.
  await sendMessage(
    tokens.bea,
    channels.general,
    `<@u:${ids.ada}:ada${suffix}> coffee?`,
  );
  await expect
    .poll(() => A.evaluate(() => window.__banners.length), {
      message: "one desktop banner requested",
    })
    .toBe(1);
  await A.evaluate(() => window.__banners[0].onclick?.());

  await expect(A, "the click opens #general").toHaveURL(
    new RegExp(`/c/${channels.general}$`),
  );
  await expect(
    A.locator(".message-content", { hasText: "coffee?" }),
    "…with the mention in it",
  ).toBeVisible();
  expect(
    await A.evaluate(() => window.__samePage === true),
    "the page was never reloaded",
  ).toBe(true);
  await expect(bar, "A is still in the call").toHaveText("Voice connected");
  await expect(
    A.locator(".channel-link.voice.connected"),
    "…and the channel row still says so",
  ).toHaveCount(1);
});

import type { WebSocketRoute } from "@playwright/test";
import { expect, reload, say, seed, signIn, test } from "./lib";

// The socket delivers: right after landing, a few seconds on, and again
// after a reload. Reconnection churn is the subject, so page errors and
// 401/404 console noise are not failures here.
// Ported from web/e2e/realtime.mjs (STOOP-238).
test("messages arrive live, later, and after a reload", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  await signIn(A, tokens.ada);
  await expect(A.locator(".composer .rich-editor-content")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();

  await say(A, "msg1 right away");
  await expect(
    B.locator(".message-list"),
    "B sees a message sent right after landing",
  ).toContainText("msg1");

  // The gap is the point: the connection has to still carry a message a
  // few seconds after it went quiet.
  await B.waitForTimeout(4000);
  await say(A, "msg2 after 4s");
  await expect(
    B.locator(".message-list"),
    "B sees a message sent a few seconds later",
  ).toContainText("msg2");

  await reload(B);
  await say(A, "msg3 after reload");
  await expect(
    B.locator(".message-list"),
    "B sees a message after reloading",
  ).toContainText("msg3");
});

// A socket that drops misses what is said meanwhile; the reconnection
// brings it without a reload. B's socket is routed through Playwright so
// the spec can cut it and hold the next one from connecting while A
// talks; once it is let through, the gateway's Ready makes B's channel
// log ask ListChanges from the seq it holds (docs/architecture/realtime.md
// → The channel log on the client).
test("a reconnection brings what was missed, without a reload", async ({
  browser,
}) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  // Every socket B opens goes through here: passed to the server, and
  // remembered so the spec can cut the live one. While `held` is set a
  // new socket waits on it before connecting, so B stays down for as
  // long as the spec needs.
  let live: { page: WebSocketRoute; server: WebSocketRoute } | null = null;
  let held: Promise<void> | null = null;
  await B.routeWebSocket(/\/ws(\?|$)/, async (page) => {
    if (held) await held;
    const server = page.connectToServer();
    live = { page, server };
  });

  await signIn(A, tokens.ada);
  await expect(A.locator(".composer .rich-editor-content")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();

  await say(A, "before the drop");
  await expect(B.locator(".message-list")).toContainText("before the drop");

  // Cut B's socket and keep the next one from connecting.
  let release: () => void = () => {};
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cut = live as { page: WebSocketRoute; server: WebSocketRoute } | null;
  if (!cut) throw new Error("B's socket was never routed");
  // Closing the page's side closes the server's with it.
  await cut.page.close({ reason: "cut by the spec" });
  await expect(
    B.locator(".status-icon.reconnecting"),
    "B's status shows the socket is down",
  ).toBeAttached();

  await say(A, "while B was away");
  await expect(
    A.locator(".message-list"),
    "A's own message landed",
  ).toContainText("while B was away");

  // Let B's next socket through: Ready, then the catch-up.
  held = null;
  release();
  await expect(B.locator(".status-icon.connected")).toBeAttached();
  await expect(
    B.locator(".message-list"),
    "B sees what was said while its socket was down, without a reload",
  ).toContainText("while B was away");
  await expect(
    B.locator(".message-list .message", { hasText: "while B was away" }),
    "once, not twice",
  ).toHaveCount(1);
});

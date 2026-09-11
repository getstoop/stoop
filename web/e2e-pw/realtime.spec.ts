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
  await expect(A.locator(".composer textarea")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

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
  // Wait for the new socket, so what follows is a push and not the load.
  await B.locator(".status-icon.connected").waitFor();
  await say(A, "msg3 after reload");
  await expect(
    B.locator(".message-list"),
    "B sees a message after reloading",
  ).toContainText("msg3");
});

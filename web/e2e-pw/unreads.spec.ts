import { expect, test } from "@playwright/test";
import { acceptDialog, channelLink, pastGate, say } from "./lib";

// Ported verbatim from web/e2e/unreads.mjs for STOOP-228. Same 18
// assertions in the same order; the difference is that nothing sleeps.
test("unread markers, dividers and the space dot", async ({ browser }) => {
  const suffix = String(Date.now() % 1000000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  for (const p of [A, B]) p.on("dialog", (d) => d.accept());

  // A sets up "Stoop HQ" (+ #random), B joins.
  await A.goto("/");
  await expect(A).toHaveURL(/\/setup$/);
  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill("correct horse battery");
  await A.locator('button[type="submit"]').click();
  await A.locator('input[placeholder="The Porch"]').fill("Stoop HQ");
  await A.locator('button[type="submit"]').click();
  // Setup step 3 (reaching your server) is skippable.
  await A.locator("button.reach-continue").click();
  const link = await A.locator(".link-box code").textContent();
  await A.locator("button.primary").click();
  await A.locator('button[aria-label="Add channel"]').click();
  await acceptDialog(A, "random");
  await channelLink(A, "random").click();

  await B.goto(link ?? "/");
  await pastGate(B);
  await B.locator('input[autocomplete="username"]').fill(`bea${suffix}`);
  await B.locator('input[type="password"]').fill("correct horse battery");
  await B.locator('button[type="submit"]').click();
  await expect(B.locator(".composer textarea")).toBeVisible();

  // Fresh channels: nothing bold anywhere.
  for (const [p, who] of [
    [A, "A"],
    [B, "B"],
  ] as const) {
    await expect(channelLink(p, "general"), `${who}: #general starts read`)
      .not.toHaveClass(/unread/);
    await expect(channelLink(p, "random"), `${who}: #random starts read`)
      .not.toHaveClass(/unread/);
  }

  // A is in #random; B posts in #general → bold for A, not for B (author).
  await say(B, "anyone here?");
  await expect(
    channelLink(A, "general"),
    "A: #general goes bold when B posts there",
  ).toHaveClass(/unread/);
  await expect(
    channelLink(B, "general"),
    "B: own message doesn't make #general bold",
  ).not.toHaveClass(/unread/);
  await expect(
    A.locator(".space-rail-list .pill-dot"),
    "A: the space pill shows a dot while a channel in it is unread",
  ).toBeVisible();

  await say(B, "second one");

  // A opens #general → read; bold clears; divider sits before the first new one.
  await channelLink(A, "general").click();
  await expect(
    channelLink(A, "general"),
    "A: opening the channel clears bold",
  ).not.toHaveClass(/unread/);
  await expect(A.locator(".new-divider")).toHaveText("New messages");
  await expect(
    A.locator(".new-divider + * .message-content"),
    "A: divider sits before the first unread message",
  ).toHaveText("anyone here?");
  await expect(
    A.locator(".day-divider"),
    "one day separator, reading 'Today'",
  ).toHaveText("Today");
  await expect(
    A.locator(".message-time").first(),
    "timestamps carry the full date on hover",
  ).toHaveAttribute("title", new RegExp(String(new Date().getFullYear())));

  // A message landing in the channel A is viewing stays read.
  await say(B, "still here?");
  await expect(B.locator(".message-content", { hasText: "still here?" })).toBeVisible();
  await expect(
    channelLink(A, "general"),
    "A: message in the open channel is read immediately",
  ).not.toHaveClass(/unread/);
  await expect(
    A.locator(".new-divider"),
    "A: divider stays put while reading",
  ).toHaveText("New messages");

  await channelLink(A, "random").click();
  await channelLink(A, "general").click();
  await expect(
    A.locator(".new-divider"),
    "A: reopening a fully read channel shows no divider",
  ).toHaveCount(0);

  // A posts in #random; B (in #general) sees #random bold; opening clears it.
  await channelLink(A, "random").click();
  await say(A, "psst, random");
  await expect(channelLink(B, "random"), "B: #random goes bold").toHaveClass(
    /unread/,
  );
  await channelLink(B, "random").click();
  await expect(
    channelLink(B, "random"),
    "B: opening #random clears it",
  ).not.toHaveClass(/unread/);

  // Space dot: A makes a second space and sits there; B posts in Stoop HQ.
  await A.locator('button[title="Create a space"]').click();
  await acceptDialog(A, "Second");
  await say(B, "over here");
  await expect(
    A.locator(".space-rail-list .pill-dot"),
    "A: unread dot on the other space's pill",
  ).toBeVisible();
  await A.locator(".space-rail-list a.space-pill").first().click();
  await expect(
    A.locator(".space-rail-list .pill-dot"),
    "A: the dot stays while #random is unread",
  ).toBeVisible();
  await expect(
    channelLink(A, "random"),
    "A: #random (where B posted) is bold",
  ).toHaveClass(/unread/);
  await channelLink(A, "random").click();
  await expect(
    A.locator(".space-rail-list .pill-dot"),
    "A: reading #random clears the dot",
  ).toHaveCount(0);
  await expect(
    channelLink(A, "random"),
    "A: reading #random clears the bold",
  ).not.toHaveClass(/unread/);

  // Persistence: B reloads; state survives (server-side marker).
  await B.reload();
  await pastGate(B);
  await expect(
    channelLink(B, "random"),
    "B: read state survives reload",
  ).not.toHaveClass(/unread/);
  await expect(
    channelLink(B, "general"),
    "B: #general also still read after reload",
  ).not.toHaveClass(/unread/);
});

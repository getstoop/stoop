import {
  channelLink,
  expect,
  focus,
  reload,
  say,
  seed,
  signIn,
  test,
} from "./lib";

// Unread markers, the "New messages" divider and the space dot.
// Ported from web/e2e/unreads.mjs (STOOP-238): same assertions, seeded
// bootstrap, and nothing sleeps.
test("unread markers, dividers and the space dot", async ({ browser }) => {
  const { tokens } = await seed();
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  await signIn(A, tokens.ada);
  await channelLink(A, "random").click();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

  for (const [p, who] of [
    [A, "A"],
    [B, "B"],
  ] as const) {
    await expect(
      channelLink(p, "general"),
      `${who}: #general starts read`,
    ).not.toHaveClass(/unread/);
    await expect(
      channelLink(p, "random"),
      `${who}: #random starts read`,
    ).not.toHaveClass(/unread/);
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

  // A opens #general → read; the divider sits before the first new message.
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
  await expect(
    B.locator(".message-content", { hasText: "still here?" }),
  ).toBeVisible();
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

  // A posts in #random; B (in #general) sees it bold; opening clears it.
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
  const dialog = A.locator(".modal[data-dialog]");
  await expect(dialog).toBeVisible();
  await dialog.locator(":where(input, textarea)").fill("Second");
  await dialog.locator(".modal-actions .primary").click();
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
  // Reading gates on hasAttention() — visible *and* focused — and B was
  // opened after A, so A is not the front page until it is told to be.
  await focus(A);
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
  await reload(B);
  await expect(
    channelLink(B, "random"),
    "B: read state survives reload",
  ).not.toHaveClass(/unread/);
  await expect(
    channelLink(B, "general"),
    "B: #general also still read after reload",
  ).not.toHaveClass(/unread/);
});

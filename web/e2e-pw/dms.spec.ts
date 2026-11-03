import type { Page } from "@playwright/test";
import {
  expect,
  focus,
  pastGate,
  reload,
  say,
  seed,
  sendMessage,
  signIn,
  test,
} from "./lib";

// Direct messages (STOOP-65): open one from a member's card, talk both
// ways in real time, see the DMs pill light up, survive a reload, and
// stay closed to people who aren't in it.
// Ported from web/e2e/dms.mjs (STOOP-238).
test("direct messages", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const aName = `ada${suffix}`;
  const bName = `bea${suffix}`;
  const cName = `cal${suffix}`;

  // A, B and C are all seeded members of "Stoop HQ".
  const open = async (token: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await p.locator(".composer .rich-editor-content").waitFor();
    return p;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);

  const memberRow = (p: Page, name: string) =>
    p.locator(".member-row", { hasText: name });
  const messageButton = (p: Page) => p.locator(".user-card .message-button");
  const dmsPill = (p: Page) => p.locator(".space-pill.dms");

  // Open a DM from B's row in the member list.
  await memberRow(A, bName).click();
  await expect(messageButton(A), "member card offers Message").toBeVisible();
  await messageButton(A).click();
  await expect(A, "Message opens the conversation").toHaveURL(/\/dm\//);
  const dmPath = new URL(A.url()).pathname;
  await expect(
    A.locator(".dm-title"),
    "header names the other person",
  ).toContainText(bName);
  await expect(
    A.locator(".composer .rich-editor-content"),
    "composer placeholder addresses them",
  ).toHaveAttribute("aria-placeholder", `Message @${bName}`);
  await expect(
    A.locator(".history-head"),
    "history head is DM wording",
  ).toContainText("conversation with");
  await expect(
    A.locator(".dm-link"),
    "the DM list has the one conversation",
  ).toHaveCount(1);

  // A talks (twice) and B reads it live. The rail pill counts messages,
  // the same number the row badge shows: the activity feed holds one
  // entry per conversation, but a pill reading 1 beside a row reading 2
  // would be two identical badges disagreeing (api/dms.ts →
  // dmUnreadTotal, and the unit tests beside it).
  await say(A, "hello bea");
  await A.locator(".message-content", { hasText: "hello bea" }).waitFor();
  await say(A, "you there?");
  await expect(
    dmsPill(B).locator(".pill-badge"),
    "B's DMs pill counts both messages",
  ).toHaveText("2");
  await expect(
    B.locator(".space-pill.activity .pill-dot"),
    "B's activity pill is dotted after two messages",
  ).toBeVisible();
  await expect(
    B.locator(".channel-link"),
    "B's space channel list has no DM in it",
  ).toHaveCount(1);
  await dmsPill(B).click();
  await expect(B, "the DMs pill opens the most recent conversation").toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    B.locator(".message-content", { hasText: "hello bea" }),
    "B sees A's message",
  ).toBeVisible();
  // Reading only counts while the window has attention: useMarkChannelRead
  // gates on document.hasFocus() so an unfocused tab still raises a desktop
  // alert. With three pages open only one holds focus, so B has to be at the
  // front for this to mean anything.
  await focus(B);
  await expect(
    dmsPill(B).locator(".pill-badge"),
    "reading the DM clears B's alert",
  ).toHaveCount(0);
  await say(B, "hi ada");
  await expect(
    A.locator(".message-content", { hasText: "hi ada" }),
    "A sees B's reply live",
  ).toBeVisible();
  await expect(
    A.locator(".space-pill.activity .pill-dot"),
    "A, reading the DM, gets no lingering alert",
  ).toHaveCount(0);

  // Reload keeps it.
  await reload(A);
  await expect(A, "the conversation survives a reload").toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    A.locator(".message-content"),
    "…with all three messages still in it",
  ).toHaveCount(3);

  // C is not in it: the URL bounces to the DM list.
  await C.goto(dmPath);
  await pastGate(C);
  await expect(C, "an outsider is bounced off the DM").toHaveURL(/\/dm$/);
  await expect(
    C.locator(".dm-empty"),
    "…and sees the empty DM list",
  ).toBeVisible();

  // C opens their own DM with A; A's list now has two, newest first.
  await C.goto("/");
  await memberRow(C, aName).click();
  await messageButton(C).click();
  await C.waitForURL(/\/dm\//);
  await say(C, "hey from cal");
  const list = A.locator(".dm-link .channel-name");
  await expect(list, "A's DM list holds both conversations").toHaveCount(2);
  await expect(list.first(), "the newest is first").toHaveText(cName);
  await expect(
    dmsPill(A).locator(".pill-badge"),
    "A is alerted to the new conversation",
  ).toHaveText("1");

  // Closing (STOOP-249): the row goes from A's list and nobody else's,
  // and the next message from that side brings it back.
  const calRow = A.locator(".channel-row", {
    has: A.locator(".dm-link", { hasText: cName }),
  });
  await calRow.hover();
  await calRow.locator(".dots-menu-button").click();
  await A.getByRole("menuitem", {
    name: "Close conversation",
    exact: true,
  }).click();
  await expect(list, "closing takes the conversation off A's list").toHaveCount(
    1,
  );
  await expect(C.locator(".dm-link"), "…and not off cal's").toHaveCount(1);
  await say(C, "still there?");
  await expect(list, "a new message brings it back").toHaveCount(2);
  await expect(list.first(), "…at the top").toHaveText(cName);
});

// A conversation has one entry in the activity feed while unread, and a
// further message refreshes it under a new id (messaging.md → The DM feed
// collapses), so the entry sorts to the top of New past whatever arrived
// in between, live and after a reload, with the newest preview.
test("a direct message lifts its one feed entry to the top", async ({
  browser,
}) => {
  const { suffix, tokens, ids, channels } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const aName = `ada${suffix}`;

  // A keeps the activity page open, where nothing is read until tapped.
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada, "/activity");
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.bea);
  await B.locator(".composer .rich-editor-content").waitFor();

  await B.locator(".member-row", { hasText: aName }).click();
  await B.locator(".user-card .message-button").click();
  await expect(B, "Message opens the conversation").toHaveURL(/\/dm\//);
  await say(B, "hello ada");

  const fresh = A.locator(".activity-section.new .activity-row");
  const conversation = fresh.filter({ hasText: "sent you a direct message" });
  await expect(conversation, "the first message makes the entry").toHaveCount(
    1,
  );

  // Three mentions from C put the conversation's entry below them.
  for (const word of ["one", "two", "three"]) {
    await sendMessage(
      tokens.cal,
      channels.general,
      `<@u:${ids.ada}:${aName}> ${word}`,
    );
  }
  await expect(fresh, "three mentions join the DM in New").toHaveCount(4);
  await expect(fresh.first(), "the newest mention is on top").toContainText(
    "mentioned you",
  );

  // B writes again: the entry climbs, once, with the newest preview.
  await say(B, "you there?");
  await expect(
    fresh.first(),
    "the conversation's entry is back on top",
  ).toContainText("you there?");
  await expect(conversation, "the conversation is listed once").toHaveCount(1);
  await expect(fresh, "and nothing else moved").toHaveCount(4);

  // The feed as the server lists it says the same.
  await reload(A);
  await expect(
    fresh.first(),
    "after a reload the entry is still on top",
  ).toContainText("you there?");
  await expect(conversation, "and still listed once").toHaveCount(1);
  await expect(fresh, "with the mentions below it").toHaveCount(4);
});

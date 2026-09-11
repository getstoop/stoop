import type { Page } from "@playwright/test";
import {
  expect,
  focus,
  pastGate,
  reload,
  say,
  seed,
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
    await p.locator(".composer textarea").waitFor();
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
    A.locator(".composer textarea"),
    "composer placeholder addresses them",
  ).toHaveAttribute("placeholder", `Message @${bName}`);
  await expect(
    A.locator(".history-head"),
    "history head is DM wording",
  ).toContainText("conversation with");
  await expect(
    A.locator(".dm-link"),
    "the DM list has the one conversation",
  ).toHaveCount(1);

  // A talks (twice); B gets one alert for the conversation, not one per
  // message, and reads it live.
  await say(A, "hello bea");
  await A.locator(".message-content", { hasText: "hello bea" }).waitFor();
  await say(A, "you there?");
  await expect(
    dmsPill(B).locator(".pill-badge"),
    "B's DMs pill shows one alert for the conversation",
  ).toHaveText("1");
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
  // Reading only counts while the window has attention: useAutoReadActivity
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
});

import type { Page } from "@playwright/test";
import { acceptDialog, expect, pastGate, seed, signIn, test } from "./lib";

// Bans and blocks (STOOP-82): a person can block another (no DMs either
// way, undo from the profile page); a manager can ban someone from a
// space, which removes them and refuses the invite link until they're
// unbanned from the space's settings.
// Ported from web/e2e/bans.mjs (STOOP-238).
test("blocking a person, banning them from a space", async ({ browser }) => {
  const { invite, suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
    invite: true,
  });
  const aName = `ada${suffix}`;
  const bName = `bea${suffix}`;
  const cName = `cal${suffix}`;

  // A, B and C are all members; the ban has to turn the invite link away.
  const open = async (token: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await p.locator(".composer textarea").waitFor();
    return p;
  };
  const A = await open(tokens.ada);
  const spaceUrl = A.url();
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);

  const blockButton = (p: Page) => p.locator(".user-card .block-button");
  const openCard = async (p: Page, name: string) => {
    await p.locator(".member-row", { hasText: name }).click();
    await p.locator(".user-card").waitFor();
  };
  const spaceMenu = async (p: Page, label: string) => {
    await p.locator(".sidebar-header .dots-menu-button").click();
    await p
      .locator(".dots-menu")
      .getByRole("menuitem", { name: label, exact: true })
      .click();
  };

  // --- Blocking ---
  await openCard(A, bName);
  await expect(blockButton(A), "card offers Block").toHaveText("Block");
  await blockButton(A).click();
  await acceptDialog(A);
  await expect(
    blockButton(A),
    "after confirming, the chip reads Unblock",
  ).toHaveText("Unblock");
  await A.keyboard.press("Escape");

  // The blocked side can't open a conversation.
  await openCard(B, aName);
  await B.locator(".user-card .message-button").click();
  await expect(
    B.locator(".modal[data-dialog]"),
    "blocked person's Message is refused",
  ).toContainText("can't message");
  await B.keyboard.press("Escape");
  await expect(B, "…and no conversation is opened").not.toHaveURL(/\/dm\//);
  await B.keyboard.press("Escape");

  // Undo from the profile page.
  await A.goto("/profile?tab=security");
  await expect(
    A.locator(".blocked-section"),
    "profile lists the blocked person",
  ).toContainText(bName);
  await A.locator(".blocked-section .chip").click();
  await expect(
    A.locator(".blocked-section"),
    "unblocking empties the section",
  ).toHaveCount(0);
  await openCard(B, aName);
  await B.locator(".user-card .message-button").click();
  await expect(B, "after unblock, Message opens a DM").toHaveURL(/\/dm\//);

  // --- Banning (from Space settings → Members) ---
  await A.goto(spaceUrl);
  await pastGate(A);
  await openCard(A, cName);
  await expect(
    A.locator(".user-card .ban-button"),
    "the profile card carries no Ban button",
  ).toHaveCount(0);
  await A.keyboard.press("Escape");
  await spaceMenu(A, "Space settings");
  await A.locator('.settings-tab[data-tab="members"]').click();
  const memberRow = (p: Page, name: string) =>
    p.locator(".user-row", { hasText: name });
  await memberRow(A, cName).locator(".ban-button").click();
  await acceptDialog(A);
  await expect(
    memberRow(A, cName),
    "banned person leaves the member list",
  ).toHaveCount(0);
  await A.locator('.settings-tab[data-tab="banned"]').click();
  await expect(
    A.locator(".bans-section"),
    "settings lists the ban",
  ).toContainText(cName);
  await C.goto(invite.url);
  await pastGate(C);
  await expect(
    C.locator(".empty-state .error"),
    "the invite link refuses them",
  ).toContainText("can't rejoin");

  // Unban from settings; the same link works again.
  await A.locator(".bans-section .chip").click();
  await expect(
    A.locator(".bans-section"),
    "unbanning empties the list",
  ).toContainText("Nobody is banned");
  await C.goto(invite.url);
  await pastGate(C);
  await expect(C, "after unban, the link admits them").toHaveURL(/\/s\//);
});

import type { Page } from "@playwright/test";
import { acceptDialog, expect, say, seed, signIn, test } from "./lib";

// An announcement channel: the owner turns it on, a member's composer
// becomes a notice without a reload, the member can still react, and
// turning it off brings the composer back (STOOP-116).
test("an announcement channel", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);

  const menuItem = async (p: Page, label: string) => {
    await p.locator(".channel-row .dots-menu-button").click();
    await p.getByRole("menuitem", { name: label, exact: true }).click();
  };
  const composer = (p: Page) => p.locator(".composer textarea");
  const notice = (p: Page) => p.locator(".posting-closed");

  await expect(composer(B), "a member starts with a composer").toBeVisible();

  // ---- On, from the ⋮, after a confirm
  await menuItem(A, "Make announcement channel");
  await acceptDialog(A);
  await expect(
    notice(B),
    "the member's composer becomes the notice",
  ).toContainText("#general is an announcement channel.");
  await expect(composer(B), "…with no composer left").toHaveCount(0);
  await expect(
    B.locator(".channel-link .channel-hash.icon"),
    "the sidebar marks the channel",
  ).toBeVisible();
  await expect(
    composer(A),
    "the owner keeps a composer that says it announces",
  ).toHaveAttribute("placeholder", "Announce in #general");

  // ---- The owner posts; the member reacts
  await say(A, "moving boxes on Saturday");
  const message = B.locator(".message", {
    hasText: "moving boxes on Saturday",
  });
  await message.hover();
  await message.locator('.message-action[aria-label="Add reaction"]').click();
  await B.locator('.emoji-common .emoji-option[title="thumbs up"]').click();
  await expect(
    A.locator(".message .reaction-chip", { hasText: "👍" }),
    "a member's reaction lands",
  ).toBeVisible();

  // ---- Off again, no confirm
  await menuItem(A, "Let everyone post");
  await expect(composer(B), "the member's composer comes back").toBeVisible();
  await expect(notice(B)).toHaveCount(0);
  await say(B, "thanks");
  await expect(A.locator(".message", { hasText: "thanks" })).toBeVisible();
});

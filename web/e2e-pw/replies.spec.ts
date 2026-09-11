import type { Locator, Page } from "@playwright/test";
import { expect, say, seed, signIn, test } from "./lib";

// Replying: the bar that says who and what, the quote on the sent
// message, the "replied to you" activity item, and the jump back to the
// original. A reply to yourself quotes but doesn't notify.
// Ported from web/e2e/replies.mjs (STOOP-238).
test("replies quote, notify and jump back", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const replyBar = (p: Page) => p.locator(".reply-bar");
  const activityPill = (p: Page) => p.locator(".space-pill.activity");
  const lastQuote = (p: Page) =>
    p.locator(".message").last().locator(".reply-quote");
  const replyTo = async (message: Locator) => {
    await message.hover();
    await message.locator('.message-action[aria-label="Reply"]').click();
  };

  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);

  await say(A, "anyone up for pizza?");
  await A.locator(".message-content", { hasText: "pizza" }).waitFor();
  // A looks away so the alert isn't auto-read.
  await A.locator(".space-pill.avatar").click();

  // B replies via the hover action.
  await replyTo(B.locator(".message").first());
  await expect(replyBar(B), "reply bar shows who").toContainText(
    `Replying to ada${suffix}`,
  );
  await expect(replyBar(B), "reply bar shows what").toContainText("pizza");
  await say(B, "yes! 7pm?");
  await expect(replyBar(B), "reply bar clears after sending").toHaveCount(0);
  await expect(
    lastQuote(B),
    "the quote names the original's author",
  ).toContainText(`ada${suffix}`);
  await expect(
    lastQuote(B),
    "the quote carries the original message",
  ).toContainText("anyone up for pizza?");

  // A is notified with "replied to you".
  await expect(
    activityPill(A).locator(".pill-dot"),
    "A gets an activity item",
  ).toBeVisible();
  await activityPill(A).click();
  await expect(
    A.locator(".activity-row"),
    "timeline says 'replied to you'",
  ).toContainText(`bea${suffix} replied to you in #general`);
  await A.locator(".activity-row.unread").click();
  await expect(
    activityPill(A).locator(".pill-dot"),
    "opening it clears the badge",
  ).toHaveCount(0);

  // Clicking the quote jumps to (and flashes) the original.
  const original = A.locator(".message").first();
  await A.locator(".reply-quote").click();
  await expect(original, "clicking the quote flashes the original").toHaveClass(
    /flash/,
  );
  await expect(
    original.locator(".message-content"),
    "the flash is on the original message",
  ).toHaveText("anyone up for pizza?");

  // Esc cancels a pending reply; a self-reply makes no activity item.
  await replyTo(original);
  await expect(replyBar(A), "Reply opens the bar").toBeVisible();
  await A.keyboard.press("Escape");
  await expect(replyBar(A), "Esc cancels the reply").toHaveCount(0);
  await replyTo(original);
  await say(A, "replying to myself");
  await expect(lastQuote(A), "a self-reply still quotes").toContainText(
    "pizza",
  );
  await expect(
    activityPill(A).locator(".pill-dot"),
    "a self-reply doesn't notify",
  ).toHaveCount(0);
});

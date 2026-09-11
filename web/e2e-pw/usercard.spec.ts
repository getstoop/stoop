import { expect, say, seed, signIn, test } from "./lib";

// The profile card behind a message author's name: who they are now (not
// who they were when they posted), what they are in this space, and the
// two ways to close it.
// Ported from web/e2e/usercard.mjs (STOOP-238).
test("the card behind an author's name", async ({ browser }) => {
  const { suffix, tokens } = await seed({ users: ["ada", "friend"] });

  // A owns the space and admins the instance.
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  // A renames themselves so we can verify the card fetches fresh.
  await A.locator(".space-pill.avatar").click();
  await A.locator("#display-name").fill("Ada W.");
  const save = A.locator('.profile-form button[type="submit"]');
  await save.click();
  await expect(save, "the rename is saved").toHaveText("Saved");
  await A.goBack();
  await say(A, "hello from the owner");

  // B, a member, says hi.
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.friend);
  await say(B, "hi from a member");

  // B clicks the owner's name.
  await B.locator(".message-author").first().click();
  const card = B.locator(".user-card");
  await expect(
    card.locator(".user-card-names strong"),
    "card shows the current display name",
  ).toHaveText("Ada W.");
  await expect(
    card.locator(".user-card-names .muted"),
    "card shows the handle",
  ).toContainText(`@ada${suffix}`);
  await expect(
    card.locator(".user-card-badges"),
    "card shows the owner badge",
  ).toContainText("owner");
  await expect(
    card.locator(".user-card-badges"),
    "card shows the server admin badge",
  ).toContainText("server admin");
  await expect(card, "card shows joined date").toContainText(
    "Joined this space",
  );
  await B.keyboard.press("Escape");
  await expect(card, "Escape closes the card").toHaveCount(0);

  // A clicks the member's name; then clicking elsewhere closes it.
  // B's message has to have reached A, or last() is A's own.
  await A.locator(".message").nth(1).waitFor();
  await A.locator(".message-author").last().click();
  const memberCard = A.locator(".user-card");
  await expect(
    memberCard.locator(".user-card-names .muted"),
    "the card is the member's",
  ).toContainText(`@friend${suffix}`);
  await expect(
    memberCard.locator(".user-card-badges"),
    "owner sees the member's role",
  ).toContainText("member");
  await expect(
    memberCard.locator(".user-card-badges"),
    "a member carries no admin badge",
  ).not.toContainText("server admin");
  await A.mouse.click(5, 5);
  await expect(memberCard, "outside click closes the card").toHaveCount(0);
});

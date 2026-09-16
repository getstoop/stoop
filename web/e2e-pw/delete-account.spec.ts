import { expect, say, seed, signIn, test } from "./lib";

// Deleting your own account (STOOP-222): what the page says, what it asks
// for, and what everyone else sees afterwards. The rules themselves are
// covered over HTTP in internal/app/e2e_account_test.go; this is the
// person's side of it.
test("deleting your own account", async ({ browser }) => {
  const { suffix, tokens } = await seed();
  const bName = `bea${suffix}`;
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);

  await say(B, "remember me");
  await expect(
    A.locator(".message-content", { hasText: "remember me" }),
  ).toBeVisible();

  // The card says what stays and what goes before asking for anything.
  await B.goto("/profile?tab=security");
  const card = B.locator(".delete-account");
  await expect(card, "the card spells out the consequences").toContainText(
    "Your messages stay",
  );
  await card.getByRole("button", { name: "Delete my account…" }).click();
  await card.locator('input[type="password"]').fill("wrong");
  await card.getByRole("button", { name: "Delete my account" }).click();
  await expect(
    card.locator(".error"),
    "a wrong password is refused",
  ).toContainText("incorrect");
  await card.locator('input[type="password"]').fill("correct horse battery");
  await card.getByRole("button", { name: "Delete my account" }).click();
  await expect(B, "the deleted account lands on the login page").toHaveURL(
    /\/login/,
  );

  // Everyone else: the message is still there, under a name marked deleted,
  // and the person is out of the space.
  const row = A.locator(".message", { hasText: "remember me" });
  await expect(
    row.locator(".deleted-mark"),
    "the author is marked deleted",
  ).toHaveText("(deleted)");
  await expect(row, "…under the username").toContainText(bName);
  await expect(
    A.locator(".member-row", { hasText: bName }),
    "and they are no longer a member",
  ).toHaveCount(0);
});

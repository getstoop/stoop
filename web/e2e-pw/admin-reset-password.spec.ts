import { acceptDialog, expect, live, seed, signIn, test } from "./lib";

// An admin resets a member's password: the temporary one is shown once, in
// a modal that says what happens for the person, and it logs them in.
test("resetting someone's password from Server admin", async ({ browser }) => {
  const { suffix, tokens } = await seed();
  const bea = `bea${suffix}`;
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada, "/admin?tab=accounts");

  await A.locator(".dt-row", { hasText: `@${bea}` })
    .locator(`button[aria-label="Actions for @${bea}"]`)
    .click();
  await A.locator(".dots-menu button", { hasText: "Reset password" }).click();
  await acceptDialog(A);

  const modal = A.locator(".modal", { hasText: "password was reset" });
  await expect(modal, "the reset ends in a modal").toBeVisible();
  await expect(modal, "that says what it means for them").toContainText(
    "They log in with their username and this password.",
  );
  const password = await modal.locator("[data-secret]").innerText();
  expect(password, "a 16-character temporary password").toHaveLength(16);
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal, "Done closes it").toHaveCount(0);

  // The temporary password works.
  const B = await (await browser.newContext()).newPage();
  await B.goto("/login");
  await B.locator('input[autocomplete="username"]').fill(bea);
  await B.locator('input[type="password"]').fill(password);
  await B.locator('button[type="submit"]').click();
  await live(B);
  await expect(B, "they're in").not.toHaveURL(/\/login/);
});

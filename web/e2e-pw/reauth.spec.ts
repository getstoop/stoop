import { ageSessions, expect, say, seed, signIn, test } from "./lib";

// Confirm it's you (STOOP-511): a session too old for account changes
// confirms on /confirm and comes back with a new one. The rules are
// covered over HTTP in internal/auth/recent_sign_in_test.go; this is the
// person's side of it, and the other tab that must carry on.
test("confirming it's you before account changes", async ({ browser }) => {
  const { tokens, password } = await seed();
  await ageSessions();
  const context = await browser.newContext();
  const P = await context.newPage();
  const other = await context.newPage(); // another tab, same browser
  await signIn(P, tokens.ada, "/profile?tab=security");
  await signIn(other, tokens.ada);

  const banner = P.locator(".confirm-banner");
  const save = P.locator(
    '.card:has(input[autocomplete="new-password"]) button[type="submit"]',
  );
  const waiting = P.locator(".needs-confirm").first();
  await expect(banner, "an old sign-in is asked to confirm").toBeVisible();
  await expect(save, "and the forms wait for it").toBeDisabled();
  await expect(waiting, "dimmed while they wait").toHaveCSS("opacity", "0.5");
  await expect(
    P.locator(".sessions-section"),
    "signing out needs no confirming, so it comes first, undimmed",
  ).toHaveCSS("opacity", "1");

  await banner.getByRole("button", { name: "Confirm it's you" }).click();
  await expect(P).toHaveURL(/\/confirm\?next=/);
  const field = P.locator('input[autocomplete="current-password"]');
  await field.fill("not the password");
  await P.getByRole("button", { name: "Confirm" }).click();
  await expect(
    P.locator(".login-card .error, .login-card .field-error").first(),
    "a wrong password says only that it didn't work",
  ).toHaveText("Couldn't confirm it's you. Try again.");

  await field.fill(password);
  await P.getByRole("button", { name: "Confirm" }).click();
  await expect(P, "back where they were").toHaveURL(/\/profile\?tab=security$/);
  await expect(banner, "with a recent sign-in").toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(waiting).toHaveCSS("opacity", "1");

  // The other tab's socket was opened with the replaced session; it picks
  // up the new one and keeps hearing the room rather than signing out.
  const bea = await (await browser.newContext()).newPage();
  await signIn(bea, tokens.bea);
  await say(bea, "still there?");
  await expect(
    other.locator(".message-content", { hasText: "still there?" }),
    "the other tab is still live",
  ).toBeVisible();
  await expect(other).not.toHaveURL(/\/login/);
});

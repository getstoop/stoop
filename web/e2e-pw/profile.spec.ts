import { expect, reload, seed, signIn, test } from "./lib";

// The account page: who you are, the tabs it is split into, changing
// your password (which revokes every other session), and logging out and
// back in with the new one.
// Ported from web/e2e/profile.mjs (STOOP-238).
test("the account page, password change and log out", async ({ browser }) => {
  const { suffix, tokens, password } = await seed({
    users: ["ada"],
    channels: ["general"],
  });
  const user = `ada${suffix}`;
  const newPass = "even more correct 42";

  const P = await (await browser.newContext()).newPage();
  await signIn(P, tokens.ada);

  // A second session, which the password change below should revoke.
  const Q = await (await browser.newContext()).newPage();
  await Q.goto("/login");
  await Q.locator('input[autocomplete="username"]').fill(user);
  await Q.locator('input[type="password"]').fill(password);
  await Q.locator('button[type="submit"]').click();
  await expect(Q, "second session logged in").not.toHaveURL(/\/login/);

  await expect(
    P.locator(".space-pill.avatar"),
    "rail shows initials pill",
  ).toHaveText("A");
  await P.locator(".space-pill.avatar").click();
  await expect(P, "pill opens /profile").toHaveURL(/\/profile$/);
  await expect(
    P.locator(".profile-header"),
    "the nav shows @username",
  ).toContainText(`@${user}`);
  await expect(
    P.locator(".settings-head"),
    "the page says member since",
  ).toContainText("Member since");
  await expect(
    P.locator(".settings-head"),
    "server-admin badge shown for the first account",
  ).toContainText("server admin");

  // Display name.
  await P.locator("#display-name").fill("Ada Whitfield");
  await P.locator('.card button[type="submit"]').click();
  await expect(
    P.locator(".profile-header h2"),
    "display name updates in header",
  ).toHaveText("Ada Whitfield");
  await expect(
    P.locator(".space-pill.avatar"),
    "rail pill initials update",
  ).toHaveText("AW");
  await expect(
    P.locator('.card button[type="submit"]'),
    "save button confirms",
  ).toHaveText("Saved");

  // Password, linked accounts, blocked people and log out live under the
  // Security tab; the theme cards under Appearance, the status and the
  // desktop banners under Notifications, and everything silenced under
  // Muted. A browser is offered all five: the desktop shell hides
  // Appearance and Notifications because it keeps those itself, and this
  // suite is a browser.
  await expect(
    P.locator(".settings-tab"),
    "the account page has five tabs",
  ).toHaveText(["Profile", "Appearance", "Notifications", "Muted", "Security"]);
  await P.locator('.settings-tab[data-tab="notifications"]').click();
  await expect(P, "the Notifications tab is a URL you can link to").toHaveURL(
    /\?tab=notifications$/,
  );
  await expect(
    P.locator(".status-section"),
    "and is where the status is set from a browser",
  ).toHaveCount(1);
  await P.locator('.settings-tab[data-tab="muted"]').click();
  await expect(P, "the Muted tab is a URL you can link to").toHaveURL(
    /\?tab=muted$/,
  );
  await expect(
    P.locator(".mutes-section"),
    "and starts with nothing muted",
  ).toContainText("You haven't muted anything.");
  await P.locator('.settings-tab[data-tab="security"]').click();
  await expect(P, "the Security tab is a URL you can link to").toHaveURL(
    /\?tab=security$/,
  );

  // The password card, found by what it contains, not its position:
  // cards get added to this page (Linked accounts sits under it).
  const pw = P.locator('.card:has(input[autocomplete="current-password"])');
  const current = pw.locator('input[autocomplete="current-password"]');
  const next = pw.locator('input[autocomplete="new-password"]');
  await current.fill("nope nope nope");
  await next.first().fill(newPass);
  await next.last().fill(newPass);
  await pw.locator('button[type="submit"]').click();
  await expect(
    pw.locator(".error"),
    "wrong current password rejected",
  ).toHaveText("current password is incorrect");

  await current.fill(password);
  await next.first().fill(newPass);
  await next.last().fill(newPass);
  await pw.locator('button[type="submit"]').click();
  await expect(
    pw.locator('button[type="submit"]'),
    "password changed",
  ).toHaveText("Password changed");
  await reload(Q);
  await expect(Q, "other session revoked").toHaveURL(/\/login/);

  // Log out and back in with the new password.
  await P.locator(".logout-link").click();
  await expect(P, "log out from profile").toHaveURL(/\/login/);
  await P.locator('input[autocomplete="username"]').fill(user);
  await P.locator('input[type="password"]').fill(newPass);
  await P.locator('button[type="submit"]').click();
  await expect(P, "new password logs in").not.toHaveURL(/\/login/);
});

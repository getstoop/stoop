import {
  BASE as base,
  harness,
  reloadShared,
  seed,
  signIn,
  sleep,
  waitFor,
} from "./lib.mjs";

const { browser, check, newPage, done } = await harness();
const { suffix, tokens, password } = await seed({
  users: ["ada"],
  channels: ["general"],
});
const user = `ada${suffix}`,
  pass = password,
  newPass = "even more correct 42";

const P = await newPage("P");
await signIn(P, tokens.ada);

// a second session that should be revoked by the password change
const Q = await (await browser.createBrowserContext()).newPage();
await Q.goto(`${base}/login`, { waitUntil: "networkidle0" });
await Q.type('input[autocomplete="username"]', user);
await Q.type('input[type="password"]', pass);
await Q.click('button[type="submit"]');
check(
  await waitFor(() => new URL(Q.url()).pathname !== "/login"),
  "second session logged in",
);
await sleep(2000);

check(
  (await P.$eval(".space-pill.avatar", (e) => e.textContent)) === "A",
  "rail shows initials pill",
);
await P.click(".space-pill.avatar");
check(
  await waitFor(() => new URL(P.url()).pathname === "/profile"),
  "pill opens /profile",
);
await sleep(600);
const head = await P.$eval(".profile-header", (e) => e.innerText);
const about = await P.$eval(".settings-head", (e) => e.innerText);
check(
  head.includes(`@${user}`) && about.includes("Member since"),
  "the nav shows @username; the page says member since",
);
check(
  about.toLowerCase().includes("server admin"),
  "server-admin badge shown for the first account",
);

// display name
await P.click("#display-name", { count: 3 });
await P.type("#display-name", "Ada Whitfield");
await P.click('.card button[type="submit"]');
check(
  await waitFor(
    async () =>
      (await P.$eval(".profile-header h2", (e) => e.textContent)) ===
      "Ada Whitfield",
  ),
  "display name updates in header",
);
check(
  await waitFor(
    async () =>
      (await P.$eval(".space-pill.avatar", (e) => e.textContent)) === "AW",
  ),
  "rail pill initials update",
);
check(
  await waitFor(
    async () =>
      (await P.$eval('.card button[type="submit"]', (e) => e.textContent)) ===
      "Saved",
  ),
  "save button confirms",
);

// Password, linked accounts, blocked people and log out live under the
// Security tab; the theme cards under Appearance, the desktop banners and
// the muted list under Notifications.
check(
  (await P.$$eval(".settings-tab", (els) => els.map((e) => e.innerText))).join(
    ",",
  ) === "Profile,Appearance,Notifications,Security",
  "the account page has four tabs",
);
await P.click('.settings-tab[data-tab="notifications"]');
check(
  await waitFor(
    async () =>
      new URL(P.url()).search === "?tab=notifications" &&
      (
        await P.$eval(".mutes-section", (e) => e.innerText).catch(() => "")
      ).includes("You haven't muted anything."),
  ),
  "the Notifications tab is a URL you can link to, and starts with nothing muted",
);
await P.click('.settings-tab[data-tab="security"]');
check(
  await waitFor(() => new URL(P.url()).search === "?tab=security"),
  "the Security tab is a URL you can link to",
);

// password — found by what it contains, not its position: cards get
// added to this page (Linked accounts sits under it).
const pw = await P.$('.card:has(input[autocomplete="current-password"])');
await (await pw.$('input[autocomplete="current-password"]')).type(
  "nope nope nope",
);
for (const f of await pw.$$('input[autocomplete="new-password"]')) {
  await f.click({ count: 3 });
  await f.type(newPass);
}
await (await pw.$('button[type="submit"]')).click();
check(
  await waitFor(
    async () =>
      (await pw.$eval(".error", (e) => e.textContent).catch(() => "")) ===
      "current password is incorrect",
  ),
  "wrong current password rejected",
);
await (await pw.$('input[autocomplete="current-password"]')).click({
  count: 3,
});
await (await pw.$('input[autocomplete="current-password"]')).type(pass);
await (await pw.$('input[autocomplete="new-password"]')).click({
  count: 3,
});
for (const f of await pw.$$('input[autocomplete="new-password"]')) {
  await f.click({ count: 3 });
  await f.type(newPass);
}
await (await pw.$('button[type="submit"]')).click();
check(
  await waitFor(
    async () =>
      (await pw.$eval('button[type="submit"]', (e) => e.textContent)) ===
      "Password changed",
  ),
  "password changed",
);
await reloadShared(Q, { waitUntil: "networkidle0" });
check(
  await waitFor(() => new URL(Q.url()).pathname === "/login"),
  `other session revoked (${new URL(Q.url()).pathname})`,
);

// logout and back in with the new password
await P.click(".logout-link");
check(
  await waitFor(() => new URL(P.url()).pathname === "/login"),
  "log out from profile",
);
await sleep(800);
await P.type('input[autocomplete="username"]', user);
await P.type('input[type="password"]', newPass);
await P.click('button[type="submit"]');
check(
  await waitFor(() => new URL(P.url()).pathname !== "/login"),
  `new password logs in (${new URL(P.url()).pathname})`,
);

await done();

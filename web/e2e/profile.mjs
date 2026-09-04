import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const suffix = String(Date.now() % 1000000);
const user = `ada${suffix}`,
  pass = "correct horse battery",
  newPass = "even more correct 42";

const P = await (await browser.createBrowserContext()).newPage();
P.on("pageerror", (e) => {
  console.log("[pageerror]", e.message);
  fails++;
});
await P.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
const viaSetup = new URL(P.url()).pathname === "/setup";
if (viaSetup) {
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.click('button[type="submit"]');
  await sleep(1500);
  await P.type('input[placeholder="The Porch"]', "Stoop HQ");
  await P.click('button[type="submit"]');
  await sleep(1500);
  // Setup step 3 (reaching your server) is skippable.
  await P.click("button.reach-continue");
  await sleep(800);
  await P.click("button.primary");
  await sleep(1500);
} else {
  await P.click("button.link");
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.click('button[type="submit"]');
  await sleep(2000);
}
// a second session that should be revoked by the password change
const Q = await (await browser.createBrowserContext()).newPage();
await Q.goto(`${base}/login`, { waitUntil: "networkidle0" });
await Q.type('input[autocomplete="username"]', user);
await Q.type('input[type="password"]', pass);
await Q.click('button[type="submit"]');
await sleep(2000);
check(new URL(Q.url()).pathname !== "/login", "second session logged in");

check(
  (await P.$eval(".space-pill.avatar", (e) => e.textContent)) === "A",
  "rail shows initials pill",
);
await P.click(".space-pill.avatar");
await sleep(600);
check(new URL(P.url()).pathname === "/profile", "pill opens /profile");
const head = await P.$eval(".profile-header", (e) => e.innerText);
const about = await P.$eval(".settings-head", (e) => e.innerText);
check(
  head.includes(`@${user}`) && about.includes("Member since"),
  "the nav shows @username; the page says member since",
);
check(
  about.toLowerCase().includes("server admin") === viaSetup,
  `server-admin badge ${viaSetup ? "shown for the setup user" : "hidden for a regular user"}`,
);

// display name
await P.click("#display-name", { count: 3 });
await P.type("#display-name", "Ada Whitfield");
await P.click('.card button[type="submit"]');
await sleep(800);
check(
  (await P.$eval(".profile-header h2", (e) => e.textContent)) ===
    "Ada Whitfield",
  "display name updates in header",
);
check(
  (await P.$eval(".space-pill.avatar", (e) => e.textContent)) === "AW",
  "rail pill initials update",
);
check(
  (await P.$eval('.card button[type="submit"]', (e) => e.textContent)) ===
    "Saved",
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
await sleep(600);
check(
  new URL(P.url()).search === "?tab=notifications" &&
    (await P.$eval(".mutes-section", (e) => e.innerText)).includes(
      "You haven't muted anything.",
    ),
  "the Notifications tab is a URL you can link to, and starts with nothing muted",
);
await P.click('.settings-tab[data-tab="security"]');
await sleep(600);
check(
  new URL(P.url()).search === "?tab=security",
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
await sleep(800);
check(
  (await pw.$eval(".error", (e) => e.textContent)) ===
    "current password is incorrect",
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
await sleep(1000);
check(
  (await pw.$eval('button[type="submit"]', (e) => e.textContent)) ===
    "Password changed",
  "password changed",
);
await Q.reload({ waitUntil: "networkidle0" });
await sleep(500);
check(
  new URL(Q.url()).pathname === "/login",
  `other session revoked (${new URL(Q.url()).pathname})`,
);

// logout and back in with the new password
await P.click(".logout-link");
await sleep(800);
check(new URL(P.url()).pathname === "/login", "log out from profile");
await P.type('input[autocomplete="username"]', user);
await P.type('input[type="password"]', newPass);
await P.click('button[type="submit"]');
await sleep(2000);
check(
  new URL(P.url()).pathname !== "/login",
  `new password logs in (${new URL(P.url()).pathname})`,
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

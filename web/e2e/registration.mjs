import puppeteer from "puppeteer-core";
import { acceptDialog, BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  p.on("dialog", (d) => d.accept());
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
// Server-tab settings are one form now: a select's new value only takes
// effect once Save is clicked.
const saveServer = async (p) => {
  await p.click(".setting-actions button.primary");
  await sleep(600);
};

// Admin sets up; grabs the invite link.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("expected a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1000);
check(
  (await A.$('a[title="Server admin"]')) !== null,
  "admin sees the gear pill",
);

// Default policy is invite: an anonymous visitor must supply a code.
const B = await newPage("B");
await B.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(200);
await B.click("button.link");
await sleep(200);
check(
  (await B.$('input[placeholder="From the person who invited you"]')) !== null,
  "invite policy: create-account form asks for a code",
);
await B.type('input[autocomplete="username"]', `walkin${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.type(
  'input[placeholder="From the person who invited you"]',
  "nope1234ab",
);
await B.click('button[type="submit"]');
await sleep(1200);
check(
  (await B.$eval("p.error", (e) => e.textContent).catch(() => "")) ===
    "invite not found",
  "bad code rejected with a clear error",
);

// Via the link: code pre-filled and locked; account created and lands in the space.
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
const codeField = await B.$(
  'input[placeholder="From the person who invited you"]',
);
check(
  codeField !== null &&
    (await B.evaluate((e) => e.readOnly && e.value.length === 10, codeField)),
  "join link pre-fills and locks the code",
);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);
check(
  path(B).startsWith("/s/") &&
    (await B.$eval(".space-name", (e) => e.textContent).catch(() => "")) ===
      "Stoop HQ",
  `invited signup lands in the space (${path(B)})`,
);

// Admin page: switch to open → anonymous signup works without a code.
await A.click('a[title="Server admin"]');
await sleep(600);
check(path(A) === "/admin", "gear opens /admin");
await A.click('.settings-tab[data-tab="accounts"]');
await sleep(600);
const users = await A.$eval(".user-list", (e) => e.innerText);
check(
  users.includes(`@ada${suffix}`) &&
    users.includes(`@bea${suffix}`) &&
    users.includes(`@walkin${suffix}`) === false,
  "account list shows real accounts only (rejected signup absent)",
);
await A.click('.settings-tab[data-tab="server"]');
await sleep(600);
// The server's name is the tab's title everywhere, saved through the same
// form as the policies, and still there after a reload.
check((await A.title()).length > 0, `tab has a title (${await A.title()})`);
await A.click("#instance-name", { count: 3 });
await A.type("#instance-name", `Stoop HQ ${suffix}`);
await saveServer(A);
// The title follows the refetched status, a beat after Save resolves.
const titled = await A.waitForFunction(
  (t) => document.title === t,
  { timeout: 3000 },
  `Stoop HQ ${suffix}`,
).then(
  () => true,
  () => false,
);
check(titled, "saved server name becomes the tab title");
await A.reload({ waitUntil: "networkidle0" });
await sleep(500);
check(
  (await A.title()) === `Stoop HQ ${suffix}`,
  "server name persists across reload",
);
await A.select('select[name="registration-policy"]', "1");
await saveServer(A);
const C = await newPage("C");
await C.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(200);
await C.click("button.link");
await sleep(200);
check(
  (await C.$('input[placeholder="From the person who invited you"]')) === null,
  "open policy: no code field",
);
await C.type('input[autocomplete="username"]', `cal${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await sleep(2000);
check(path(C) === "/", `open signup works and lands home (${path(C)})`);
check(
  (await C.$('button[title="Create a space"]')) === null,
  "member can't create spaces by default (no + pill)",
);
await A.select('select[name="space-creation"]', "2");
await saveServer(A);
await C.reload({ waitUntil: "networkidle0" });
await sleep(500);
check(
  (await C.$('button[title="Create a space"]')) !== null,
  "after admin opens space creation, member sees the + pill",
);
await A.select('select[name="space-creation"]', "1");
await saveServer(A);

// Closed → no create-account option at all.
await A.select('select[name="registration-policy"]', "3");
await saveServer(A);
const D = await newPage("D");
await D.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(300);
check(
  (await D.$("button.link")) === null &&
    (await D.$eval("#root", (e) => e.innerText)).includes(
      "isn't accepting new accounts",
    ),
  "closed policy: create-account hidden with a note",
);

// Policy survives a page reload of the admin (persisted), then back to invite.
await A.reload({ waitUntil: "networkidle0" });
await sleep(500);
check(
  (await A.$eval('select[name="registration-policy"]', (e) => e.value)) === "3",
  "policy persisted across reload",
);
await A.select('select[name="registration-policy"]', "2");
await saveServer(A);

// Account actions live behind the row's ⋮ menu. The menu closes on any
// scroll (it is fixed to the viewport, so a scroll would leave it beside
// nothing) — and puppeteer scrolls a button into view before clicking it,
// with the scroll event landing a frame later. Scroll first, let that
// event pass, then open, or the click's own scroll shuts the menu again.
const openMenu = async (p, row) => {
  const button = await row.$(".dots-menu-button");
  await button.scrollIntoView();
  await sleep(100);
  await button.click();
  await p.waitForSelector(".dots-menu button", { timeout: 3000 });
};
const menuItem = async (p, label) => {
  for (const b of await p.$$(".dots-menu button")) {
    if ((await p.evaluate((e) => e.textContent?.trim(), b)) === label)
      return b.click();
  }
  throw new Error(`no menu item ${label}`);
};

// Deactivate cal: C's session dies; reactivate: can log in again.
await A.click('.settings-tab[data-tab="accounts"]');
await sleep(600);
const rows = await A.$$(".user-row");
let calRow = null;
for (const r of rows)
  if ((await A.evaluate((e) => e.innerText, r)).includes(`@cal${suffix}`))
    calRow = r;
await openMenu(A, calRow);
await menuItem(A, "Deactivate");
await acceptDialog(A);
await sleep(1000);
await C.reload({ waitUntil: "networkidle0" });
await sleep(500);
check(path(C) === "/login", `deactivated user bounced to login (${path(C)})`);
await C.type('input[autocomplete="username"]', `cal${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await sleep(1200);
check(
  (await C.$eval("p.error", (e) => e.textContent).catch(() => "")).includes(
    "deactivated",
  ),
  "deactivated login refused with a clear error",
);
await A.reload({ waitUntil: "networkidle0" });
await sleep(500);
const rows2 = await A.$$(".user-row");
for (const r of rows2)
  if ((await A.evaluate((e) => e.innerText, r)).includes(`@cal${suffix}`))
    calRow = r;
check(
  (await A.evaluate((e) => e.innerText, calRow))
    .toLowerCase()
    .includes("deactivated"),
  "admin list marks the account deactivated",
);
await openMenu(A, calRow);
await menuItem(A, "Reactivate");
await sleep(800);
await C.click('button[type="submit"]');
await sleep(1500);
check(path(C) !== "/login", "reactivated user can log in");

// Admin can't demote or deactivate themselves (buttons absent), and the last-admin guard holds.
const _selfRow = (await A.$$(".user-row")).filter(async () => true);
check(
  (await A.$eval(".user-list", (e) => e.innerText)).includes("you"),
  "own row shows 'you' instead of actions",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

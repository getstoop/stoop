// Bans and blocks (STOOP-82): a person can block another (no DMs either
// way, undo from the profile page); a manager can ban someone from a
// space, which removes them and refuses the invite link until they're
// unbanned from the space's settings.
import puppeteer from "puppeteer-core";
import {
  acceptDialog,
  BASE as base,
  chromePath,
  dialog,
  dismissDialog,
  sleep,
  spaceMenu,
} from "./lib.mjs";

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
const dialogs = {};
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  p.on("dialog", (d) => {
    dialogs[tag] = d.message();
    d.accept();
  });
  return p;
};
const path = (p) => new URL(p.url()).pathname;

// A sets up the instance; B and C join via the invite link.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("expected a fresh instance");
const aName = `ada${suffix}`;
await A.type('input[autocomplete="username"]', aName);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1200);
const spaceUrl = A.url();

const joinAs = async (tag, name) => {
  const p = await newPage(tag);
  await p.goto(link, { waitUntil: "networkidle0" });
  await sleep(300);
  await p.type('input[autocomplete="username"]', name);
  await p.type('input[type="password"]', "correct horse battery");
  await p.click('button[type="submit"]');
  await sleep(2500);
  return p;
};
const bName = `bea${suffix}`;
const B = await joinAs("B", bName);
const cName = `cal${suffix}`;
const C = await joinAs("C", cName);
await sleep(800);

const openCard = async (page, name) => {
  for (const row of await page.$$(".member-row")) {
    const text = await row.evaluate((e) => e.textContent);
    if (text.includes(name)) {
      await row.click();
      await sleep(600);
      return;
    }
  }
  throw new Error(`no member row for ${name}`);
};
const cardText = (page, sel) =>
  page.$eval(`.user-card ${sel}`, (e) => e.textContent);

// --- Blocking ---
await openCard(A, bName);
check((await cardText(A, ".block-button")) === "Block", "card offers Block");
await A.click(".user-card .block-button");
await acceptDialog(A);
await sleep(800);
check(
  (await cardText(A, ".block-button")) === "Unblock",
  "after confirming, the chip reads Unblock",
);
await A.keyboard.press("Escape");

// The blocked side can't open a conversation.
await openCard(B, aName);
await B.click(".user-card .message-button");
const refused = await dialog(B);
await dismissDialog(B);
check(
  !path(B).startsWith("/dm/") && /can't message/.test(refused.text),
  `blocked person's Message is refused (${refused.text})`,
);
await B.keyboard.press("Escape");

// Undo from the profile page.
await A.goto(`${base}/profile?tab=security`, {
  waitUntil: "networkidle0",
});
await sleep(800);
check(
  (await A.$eval(".blocked-section", (e) => e.textContent)).includes(bName),
  "profile lists the blocked person",
);
await A.click(".blocked-section .chip");
await sleep(800);
check(
  (await A.$(".blocked-section")) === null,
  "unblocking empties the section",
);
await openCard(B, aName);
await B.click(".user-card .message-button");
await sleep(1500);
check(
  path(B).startsWith("/dm/"),
  `after unblock, Message opens a DM (${path(B)})`,
);

// --- Banning (from Space settings → Members) ---
await A.goto(spaceUrl, { waitUntil: "networkidle0" });
await sleep(800);
await openCard(A, cName);
check(
  (await A.$(".user-card .ban-button")) === null,
  "the profile card carries no Ban button",
);
await A.keyboard.press("Escape");
await sleep(200);
await spaceMenu(A, "Space settings");
await sleep(800);
await A.click('.settings-tab[data-tab="members"]');
await sleep(600);
const rowBtn = async (p, rowText, label) => {
  for (const row of await p.$$(".user-row")) {
    if (!(await p.evaluate((e) => e.innerText, row)).includes(rowText))
      continue;
    for (const b of await row.$$(".chip")) {
      if ((await p.evaluate((e) => e.textContent?.trim(), b)) === label)
        return b;
    }
  }
  return null;
};
await (await rowBtn(A, cName, "Ban")).click();
await acceptDialog(A);
await sleep(1500);
check(
  (await rowBtn(A, cName, "Kick")) === null,
  "banned person leaves the member list",
);
await A.click('.settings-tab[data-tab="banned"]');
await sleep(600);
check(
  (await A.$eval(".bans-section", (e) => e.textContent)).includes(cName),
  "settings lists the ban",
);
await C.goto(link, { waitUntil: "networkidle0" });
await sleep(1500);
check(
  (
    await C.$eval(".empty-state .error", (e) => e.textContent).catch(() => "")
  ).includes("can't rejoin"),
  "the invite link refuses them",
);

// Unban from settings; the same link works again.
await A.click(".bans-section .chip");
await sleep(800);
check(
  (await A.$eval(".bans-section", (e) => e.textContent)).includes(
    "Nobody is banned",
  ),
  "unbanning empties the list",
);
await C.goto(link, { waitUntil: "networkidle0" });
await sleep(2000);
check(
  path(C).startsWith("/s/"),
  `after unban, the link admits them (${path(C)})`,
);

await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);

import puppeteer from "puppeteer-core";
import {
  acceptDialog,
  BASE as base,
  chromePath,
  sleep,
  spaceMenu,
  spaceMenuItems,
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
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  p.on("dialog", (d) => d.accept(p.__promptAnswer ?? ""));
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const channelNames = (p) =>
  p.$$eval(".channel-link:not(.add) .channel-name", (els) =>
    els.map((e) => e.textContent),
  );
const rowBtn = async (p, rowText, label) => {
  for (const row of await p.$$(".user-row")) {
    if (!(await p.evaluate((e) => e.innerText, row)).includes(rowText))
      continue;
    for (const b of await row.$$(".chip")) {
      const t = await p.evaluate((e) => e.textContent?.trim(), b);
      const title = await p.evaluate((e) => e.title, b);
      if (t === label || title === label) return b;
    }
  }
  return null;
};

const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
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
await A.click(".channel-add");
await acceptDialog(A, "random");
await sleep(800);
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

check(
  !(await spaceMenuItems(B)).includes("Space settings"),
  "a member is not offered Space settings",
);
await spaceMenu(A, "Space settings");
await sleep(800);
check(path(A).endsWith("/settings"), `owner opens settings (${path(A)})`);

// Rename the space: sidebar and B's pill update live.
await A.click('input[aria-label="Space name"]', { count: 3 });
await A.type('input[aria-label="Space name"]', "The Porch");
await A.keyboard.press("Enter");
await sleep(800);
check((await text(A, ".profile-header h2")) === "The Porch", "space renamed");
check(
  (await text(B, ".space-name")) === "The Porch",
  "B sees the new name live",
);

// Members can invite toggle → B gains the Invite chip live.
await A.click(".toggle-row input");
await sleep(800);
check(
  (await spaceMenuItems(B)).includes("Invite people"),
  "invite toggle reaches B live",
);

// Channels: reorder, rename, delete.
await A.click('.settings-tab[data-tab="channels"]');
await sleep(500);
await (await rowBtn(A, "random", "Move up")).click();
await sleep(800);
check(
  JSON.stringify(await channelNames(B)) ===
    JSON.stringify(["random", "general"]),
  `B sees reordered channels (${await channelNames(B)})`,
);
await (await rowBtn(A, "general", "Rename")).click();
await sleep(200);
await A.click('input[aria-label="Channel name"]', { count: 3 });
await A.type('input[aria-label="Channel name"]', "lounge");
await A.keyboard.press("Enter");
await sleep(800);
check(
  (await channelNames(B)).includes("lounge"),
  "B sees the renamed channel live",
);
await B.click(".channel-link");
await sleep(500); // B is in #random
await (await rowBtn(A, "random", "Delete")).click();
await acceptDialog(A);
await sleep(1200);
check(
  !(await channelNames(B)).includes("random") && path(B).includes("/c/"),
  `B bounced out of the deleted channel (${path(B)})`,
);
check(
  (await rowBtn(A, "lounge", "Delete")) !== null &&
    (await A.evaluate((b) => b.disabled, await rowBtn(A, "lounge", "Delete"))),
  "last channel can't be deleted",
);

// Members tab: promote B from settings; B's gear appears.
await A.click('.settings-tab[data-tab="members"]');
await sleep(500);
check(
  (await text(A, ".legend")).includes("Kick"),
  "members tab explains kick/ban/block",
);
await A.click('.settings-tab[data-tab="banned"]');
await sleep(500);
check(
  (await text(A, ".bans-section")).includes("Nobody is banned"),
  "banned tab shows the empty ban list",
);
await A.click('.settings-tab[data-tab="members"]');
await sleep(500);
await (await rowBtn(A, `bea${suffix}`, "Make admin")).click();
await sleep(800);
check(
  (await spaceMenuItems(B)).includes("Space settings"),
  "a promoted member is offered Space settings live",
);
await A.click('.settings-tab[data-tab="owner"]');
await sleep(500);

// Transfer ownership to B; A becomes admin and loses the Owner section.
await A.select(
  'select[aria-label="New owner"]',
  await A.$eval(
    'select[aria-label="New owner"] option:nth-child(2)',
    (o) => o.value,
  ),
);
await A.click(".danger-zone .chip");
await acceptDialog(A);
await sleep(1000);
check(
  (await A.$('select[aria-label="New owner"]')) === null &&
    (await text(A, '.settings-tab[data-tab="owner"]')) === "Server admin",
  "after transfer, A keeps only the instance admin's delete",
);
await spaceMenu(B, "Space settings");
await sleep(800);
await B.click('.settings-tab[data-tab="owner"]');
await sleep(500);
check(
  (await B.$('select[aria-label="New owner"]')) !== null,
  "B (new owner) sees the owner section",
);

// B deletes the space: both land on home.
await B.click(".danger-zone .chip.danger");
await acceptDialog(B, "The Porch");
await sleep(1500);
check(
  path(B) === "/" && path(A) === "/",
  `space deleted; both bounced home (${path(A)}, ${path(B)})`,
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

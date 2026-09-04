// Pronouns and bio (STOOP-118): written on the profile page, read on the
// profile card and nowhere else, cleared by an admin.
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
const wire = (p, tag) =>
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
const suffix = String(Date.now() % 1000000);
const BIO = "Runs the tool library. Ask me about the bandsaw.";

// The About you card, found by what it contains rather than its position.
const ABOUT = '.card:has(input[placeholder="she/her"])';

// A: sets up the instance (admin + owner) and mints an invite link.
const A = await (await browser.createBrowserContext()).newPage();
wire(A, "A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
await A.type('input[autocomplete="username"]', `casey${suffix}`);
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

// A fills in both fields on their profile.
await A.click(".space-pill.avatar");
await sleep(600);
await A.waitForSelector(ABOUT, { timeout: 3000 });
await A.type("#pronouns", "she/her");
await A.type(`${ABOUT} textarea`, BIO);
await A.click(`${ABOUT} button[type="submit"]`);
await sleep(800);
check(
  (await A.$eval(`${ABOUT} button[type="submit"]`, (e) => e.disabled)) === true,
  "Save disables again once there is nothing left to save",
);
check(
  (await A.$eval(".profile-header p", (e) => e.innerText)).includes("she/her"),
  "profile header echoes the pronouns back",
);
// It survives a reload: the fields came from the server, not local state.
await A.reload({ waitUntil: "networkidle0" });
await sleep(800);
check(
  (await A.$eval("#pronouns", (e) => e.value)) === "she/her" &&
    (await A.$eval(`${ABOUT} textarea`, (e) => e.value)) === BIO,
  "both fields reload from the server",
);
await A.goBack();
await sleep(800);
await A.type(".composer textarea", "hello from the owner");
await A.keyboard.press("Enter");
await sleep(800);

// B joins and opens A's card from a message.
const B = await (await browser.createBrowserContext()).newPage();
wire(B, "B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `robin${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);

const openCard = async (p) => {
  const authors = await p.$$(".message-author");
  await authors[0].click();
  await p.waitForSelector(".user-card", { timeout: 3000 });
  await sleep(300);
  return p.$eval(".user-card", (e) => e.innerText);
};
const card = await openCard(B);
check(card.includes("she/her"), `card shows pronouns: ${JSON.stringify(card)}`);
check(card.includes(BIO), "card shows the bio in full");
check(
  (await B.$eval(".user-card-pronouns", (e) =>
    getComputedStyle(e.parentElement).getPropertyValue("white-space"),
  )) === "nowrap",
  "pronouns sit on the name line, which stays one line",
);
await B.keyboard.press("Escape");
await sleep(200);

// The message list itself stays clean — this is the whole point of the
// card being the only surface.
check(
  !(await B.$eval(".message-list", (e) => e.innerText)).includes("she/her"),
  "pronouns do not leak into the message list",
);
check(
  !(await B.$eval(".members-panel", (e) => e.innerText)).includes("she/her"),
  "pronouns do not leak into the members panel",
);

// B sets pronouns only, so A's card must show them with no bio.
await B.click(".space-pill.avatar");
await sleep(600);
await B.waitForSelector(ABOUT, { timeout: 3000 });
await B.type("#pronouns", "they/them");
await B.click(`${ABOUT} button[type="submit"]`);
await sleep(800);
await B.goBack();
await sleep(800);
await B.type(".composer textarea", "hi from a member");
await B.keyboard.press("Enter");
await sleep(1000);

const aAuthors = await A.$$(".message-author");
await aAuthors[aAuthors.length - 1].click();
await A.waitForSelector(".user-card", { timeout: 3000 });
await sleep(300);
const memberCard = await A.$eval(".user-card", (e) => e.innerText);
check(memberCard.includes("they/them"), "member's pronouns show on their card");
check(
  (await A.$(".user-card .user-card-bio")) === null,
  "a card with no bio has no bio row, not an empty state",
);
await A.keyboard.press("Escape");
await sleep(200);

// The same card inside a DM. This is the case that used to read the
// participant out of the DM list, which carried neither field.
const dmAuthors = await A.$$(".message-author");
await dmAuthors[dmAuthors.length - 1].click();
await A.waitForSelector(".user-card", { timeout: 3000 });
await sleep(300);
await A.click(".user-card .message-button");
await sleep(1500);
check(
  new URL(A.url()).pathname.startsWith("/dm/"),
  "opened a direct message with them",
);
// A fresh DM has nothing in it; B has to say something before there is an
// author name to click.
const dmUrl = A.url();
await A.type(".composer textarea", "about that bandsaw");
await A.keyboard.press("Enter");
await sleep(1200);
await B.goto(dmUrl, { waitUntil: "networkidle0" });
await sleep(1500);
const dmCard = await openCard(B);
check(
  dmCard.includes("she/her") && dmCard.includes(BIO),
  `the card in a DM carries both fields: ${JSON.stringify(dmCard)}`,
);
check(
  !/Joined this space/.test(dmCard),
  "and still says nothing about a space, which a DM has none of",
);
await B.keyboard.press("Escape");
await sleep(200);

// An admin takes the bio down. A (the setup user) is the server admin.
await A.goto(`${base}/admin?tab=accounts`, { waitUntil: "networkidle0" });
await sleep(1200);
const rows = await A.$$(".user-row");
let target = null;
for (const row of rows) {
  const text = await row.evaluate((e) => e.innerText);
  if (text.includes(`@robin${suffix}`)) target = row;
}
if (!target) throw new Error("robin is not in the accounts list");
check(
  (await target.evaluate((e) => e.innerText)).includes("they/them"),
  "the accounts row carries pronouns on its meta line",
);
// Bios stay off this list: it is an operational view, not a social one,
// and a wrapped paragraph per row breaks the ⋮ alignment. The confirm
// quotes the text instead.
let ownRow = "";
for (const row of rows) {
  const text = await row.evaluate((e) => e.innerText);
  if (text.includes(`@casey${suffix}`)) ownRow = text;
}
check(
  ownRow.includes("she/her") && !ownRow.includes(BIO),
  `an account with a bio shows pronouns but not the bio: ${JSON.stringify(ownRow)}`,
);
// Scroll first and let that event pass: the menu is fixed to the
// viewport and closes on any scroll, including the one puppeteer does to
// bring the button into view (see registration.mjs).
const dots = await target.$(".dots-menu-button");
await dots.scrollIntoView();
await sleep(100);
await dots.click();
await A.waitForSelector(".dots-menu button", { timeout: 3000 });
const labels = await A.$$eval(".dots-menu button", (es) =>
  es.map((e) => e.textContent.trim()),
);
check(
  labels.includes("Clear pronouns") && !labels.includes("Clear bio"),
  `only the field they actually have is offered: ${JSON.stringify(labels)}`,
);
for (const b of await A.$$(".dots-menu button")) {
  if (
    (await A.evaluate((e) => e.textContent?.trim(), b)) === "Clear pronouns"
  ) {
    await b.click();
    break;
  }
}
await acceptDialog(A);
await sleep(1000);
const afterRows = await A.$$(".user-row");
let after = "";
for (const row of afterRows) {
  const text = await row.evaluate((e) => e.innerText);
  if (text.includes(`@robin${suffix}`)) after = text;
}
check(!after.includes("they/them"), "the pronouns are gone from the row");

// And gone for the account itself, which reads it back from the server.
await B.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(1000);
check(
  (await B.$eval("#pronouns", (e) => e.value)) === "",
  "the account sees the cleared field as empty, not stale",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

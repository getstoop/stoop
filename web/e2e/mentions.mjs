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
  p.on("dialog", (d) => d.accept(p.__promptAnswer ?? ""));
  return p;
};
const suffix = String(Date.now() % 1000000);
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const path = (p) => new URL(p.url()).pathname;

// A sets up and adds a #random channel; B joins via the link.
const A = await newPage("A");
// Headless Chrome can't show native notifications; stub the API and record
// what the app tries to show.
await A.browserContext().overridePermissions(base, ["notifications"]);
await A.evaluateOnNewDocument(() => {
  window.__notes = [];
  class FakeNotification {
    static permission = "granted";
    static requestPermission() {
      return Promise.resolve("granted");
    }
    constructor(title, opts) {
      window.__notes.push({ title, body: opts?.body });
    }
    close() {}
  }
  window.Notification = FakeNotification;
});
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
await sleep(1000);
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

// A parks in #random; B mentions A in #general.
const links = await A.$$(".channel-link");
for (const l of links)
  if ((await A.evaluate((e) => e.innerText, l)).includes("random"))
    await l.click();
await sleep(600);
check((await A.$(".pill-badge")) === null, "A starts with no unread badge");
await B.type(".composer textarea", "morning @ad");
await sleep(300);
await B.waitForSelector(".mention-picker", { timeout: 3000 });
check(
  (await text(B, ".mention-picker")).includes(`@ada${suffix}`),
  "picker suggests the matching member",
);
await B.keyboard.press("Enter");
await sleep(200);
check(
  (await B.$eval(".composer textarea", (e) => e.value)) ===
    `morning @ada${suffix} `,
  "Enter completes the mention",
);
check(
  (await B.$(".mention-picker")) === null,
  "picker closes after completion",
);
await B.type(".composer textarea", "coffee?");
await B.keyboard.press("Enter");
await sleep(1500);

const notes = await A.evaluate(() => window.__notes);
check(
  notes.length === 1 &&
    notes[0].title === `bea${suffix} mentioned you` &&
    notes[0].body.includes("coffee?"),
  `desktop banner requested: ${JSON.stringify(notes[0])}`,
);

// Badges on the activity pill, space pill, and the #general channel — A is elsewhere, so nothing is auto-read.
check(
  (await A.$(".activity .pill-dot")) !== null,
  "A's activity pill is dotted",
);
check(
  (await text(A, ".space-rail-list .pill-badge")) === "1",
  "A's space pill shows 1 unread",
);
const generalLink = (await A.$$(".channel-link")).at(0);
check(
  (await A.evaluate(
    (e) => e.querySelector(".channel-badge")?.textContent,
    generalLink,
  )) === "1",
  "#general shows a channel badge",
);
check(
  (await B.$(".mention.me")) === null,
  "B's own mention isn't marked as theirs",
);

// Viewing #general via the sidebar (not the activity pill) reads the item.
await generalLink.click();
await sleep(1200);
check(
  (await text(A, ".mention.me")) === `@ada${suffix}`,
  "mention token highlighted as 'me' for A",
);
check(
  (await A.$(".activity .pill-dot")) === null,
  "viewing the channel clears the activity badge",
);
check((await A.$(".channel-badge")) === null, "and the channel badge");

// A mention that arrives while A is already looking at #general is read immediately.
await B.type(".composer textarea", `@ada${suffix} still there?`);
await B.keyboard.press("Escape");
await B.keyboard.press("Enter");
await sleep(1500);
check(
  (await A.$(".activity .pill-dot")) === null,
  "a mention arriving in the open channel is read immediately",
);

// Desktop banners are a setting, so the test button is on the profile's
// Notifications tab, not on the feed.
await A.goto(`${base}/profile?tab=notifications`, {
  waitUntil: "networkidle0",
});
await sleep(800);
for (const b of await A.$$(".card .chip"))
  if ((await b.evaluate((e) => e.textContent)) === "Send a test notification")
    await b.click();
await sleep(200);
check(
  (await A.evaluate(() => window.__notes.at(-1)?.title)) ===
    "Stoop notifications are working",
  "test button fires a desktop banner",
);

// The activity pill opens the timeline page; both mentions are listed and read.
await A.click(".activity");
await sleep(800);
check(path(A) === "/activity", "the activity pill opens /activity");
check(
  (await A.$$eval(".activity-row", (els) => els.length)) === 2,
  "timeline lists both mentions",
);
check(
  (await A.$$eval(".activity-row.unread", (els) => els.length)) === 0,
  "both are read",
);
check(
  (await text(A, ".activity-page-header")).includes("all caught up"),
  "header says caught up",
);

// A third mention while on the timeline: unread row appears; clicking it navigates and reads it.
await B.type(".composer textarea", `@ada${suffix} one more`);
await B.keyboard.press("Escape");
await B.keyboard.press("Enter");
await sleep(1500);
check(
  (await A.$$eval(".activity-row.unread", (els) => els.length)) === 1,
  "new mention shows unread on the timeline",
);
check(
  (await A.$(".activity .pill-dot")) !== null,
  "the pill is dotted while on the timeline",
);
check(
  (await text(A, ".activity-page-header")).includes("1 unread"),
  "the page header keeps the count the pill dropped",
);
await A.click(".activity-row.unread");
await sleep(1200);
check(
  path(A).includes("/c/") && (await A.$(".activity .pill-dot")) === null,
  `clicking the row navigates and reads it (${path(A)})`,
);

// Self-mention and non-member mention create nothing.
await A.type(".composer textarea", `talking to @ada${suffix} and @nobody123`);
await A.keyboard.press("Escape");
await A.keyboard.press("Enter");
await sleep(1000);
check(
  (await A.$(".activity .pill-dot")) === null,
  "self-mention doesn't notify",
);
check(
  (await A.$$eval(".mention", (els) => els.length)) === 4,
  "only real members render as mention tokens",
);

// @everyone: the owner can (picker offers it, B is notified); a member can't (plain text).
await A.click(".space-rail-list a.space-pill");
await sleep(800);
await B.click(".space-pill.avatar"); // B looks away so the alert isn't auto-read
await sleep(500);
await A.type(".composer textarea", "@ever");
await sleep(300);
check(
  (await text(A, ".mention-picker")).includes("Everyone in this space"),
  "owner's picker offers @everyone",
);
await A.keyboard.press("Enter");
await A.type(".composer textarea", "game night");
await A.keyboard.press("Enter");
await sleep(1200);
check(
  (await B.$(".activity .pill-dot")) !== null,
  "B is notified by @everyone",
);
await B.click(".space-rail-list a.space-pill");
await sleep(1200);
check(
  (
    await B.$$eval(".mention.me", (els) => els.map((e) => e.textContent))
  ).includes("@everyone"),
  "B sees the @everyone token highlighted",
);
await A.click(".space-pill.avatar"); // A looks away for the negative case
await sleep(500);
await B.type(".composer textarea", "@ever");
await sleep(300);
check(
  (await B.$(".mention-picker")) === null ||
    !(await text(B, ".mention-picker")).includes("Everyone"),
  "member's picker doesn't offer @everyone",
);
await B.keyboard.press("Escape");
await B.type(".composer textarea", "yone please");
await B.keyboard.press("Enter");
await sleep(1000);
check(
  (await A.$(".activity .pill-dot")) === null,
  "member's @everyone doesn't notify the owner",
);
check(
  (await B.$$eval(".mention", (els) => els.map((e) => e.textContent))).filter(
    (t) => t === "@everyone",
  ).length === 1,
  "member's @everyone renders as plain text",
);
await A.click(".space-rail-list a.space-pill");
await sleep(800);

// Mark all read from the timeline after a mention arrives while A is on /profile.
await A.click(".space-pill.avatar");
await sleep(500);
await B.type(".composer textarea", `@ada${suffix} last one`);
await B.keyboard.press("Escape");
await B.keyboard.press("Enter");
await sleep(1500);
check(
  (await A.$(".activity .pill-dot")) !== null,
  "mention while on /profile → the pill is dotted",
);
await A.click(".activity");
await sleep(800);
await A.click(".activity-page-header .chip");
await sleep(600);
check(
  (await A.$(".activity .pill-dot")) === null,
  "Mark all read clears the badge",
);
check(
  (await A.$$eval(".activity-row.unread", (els) => els.length)) === 0,
  "no rows remain unread",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

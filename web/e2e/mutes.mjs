// Mutes own the badges (STOOP-133): a muted channel or DM raises no dot
// and no mention badge anywhere, while the mention still reaches the
// activity feed and lights the activity pill's dot. STOOP-135 adds the
// space half: muting a space silences every channel under it.
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
const suffix = String(Date.now() % 1000000);
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  return p;
};

// A sets up, adds #random so there is somewhere to park, and invites B.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
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
await A.click(".channel-add");
await acceptDialog(A, "random");
await sleep(1000);
const bName = `bea${suffix}`;
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', bName);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(1000);

// Mute or unmute the first channel row on the page (#general, or the one
// conversation in the DM list).
const setMuted = async (page, muted) => {
  await page.hover(".channel-row");
  await page.click(".channel-row .dots-menu-button");
  await sleep(300);
  const label = muted ? "Mute" : "Unmute";
  for (const b of await page.$$(".dots-menu button")) {
    if ((await b.evaluate((e) => e.textContent)) === label) {
      await b.click();
      await sleep(600);
      return true;
    }
  }
  return false;
};
// The activity page lists items without reading them; the header's
// button is what clears the feed.
const markAllRead = async (page) => {
  const chip = await page.$(".activity-page-header .chip");
  if (!chip) return;
  await chip.click();
  await sleep(800);
};
const mention = async (page, name, body) => {
  await page.type(".composer textarea", `@${name} ${body}`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await sleep(1500);
};
// The first channel row is #general; it is the muted one throughout.
const general = async (page) => (await page.$$(".channel-row"))[0];
const generalHas = async (page, sel) =>
  (await (await general(page)).$(sel)) !== null;

// The channel row menu, and the mute it offers.
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(800);
await A.hover(".channel-row");
await A.click(".channel-row .dots-menu-button");
await sleep(300);
check(
  (
    await A.$$eval(".dots-menu button", (es) => es.map((e) => e.textContent))
  ).join(",") === "Mute,Edit name,Add a topic,Delete channel",
  "owner's channel menu: Mute, Edit name, Add a topic, Delete channel",
);
await A.keyboard.press("Escape");
await sleep(200);
check(await setMuted(A, true), "mute #general from the row menu");
check(await generalHas(A, ".channel-link.muted"), "the muted row is dimmed");

// A parks in #random so nothing in #general is read on arrival.
for (const l of await A.$$(".channel-link"))
  if ((await l.evaluate((e) => e.innerText)).includes("random"))
    await l.click();
await sleep(800);

// An ordinary message in a muted channel: no bold, no unread dot.
await B.type(".composer textarea", "ping while muted");
await B.keyboard.press("Enter");
await sleep(1200);
check(
  !(await generalHas(A, ".channel-link.unread")),
  "a new message in a muted channel doesn't bold the row",
);
check(
  (await A.$(".space-rail-list .space-pill .pill-dot")) === null,
  "and raises no unread dot on the space pill",
);

// A mention in a muted channel: activity yes, every other badge no.
await mention(B, aName, "are you around?");
check(
  (await A.$(".space-pill.activity .pill-dot")) !== null,
  "a mention in a muted channel lights the activity pill's dot",
);
check(
  !(await generalHas(A, ".channel-badge")),
  "and raises no mention badge on the channel row",
);
check(
  (await A.$(".space-rail-list .space-pill .pill-badge")) === null,
  "and none on the space pill",
);
await A.click(".space-pill.activity");
await sleep(1200);
check(
  (await A.$eval(".activity-row", (e) => e.innerText)).includes(
    "are you around?",
  ),
  "the mention is on the activity page all the same",
);
check(
  (await A.$eval(".activity-page-header", (e) => e.innerText)).includes(
    "1 unread",
  ),
  "and counts on the page header, which mutes never touch",
);
// The page lists without reading; clearing it is the header's button.
await markAllRead(A);
check(
  (await A.$(".space-pill.activity .pill-dot")) === null,
  "marking all read clears the pill's dot",
);

// Unmuting brings the badges back.
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1000);
for (const l of await A.$$(".channel-link"))
  if ((await l.evaluate((e) => e.innerText)).includes("random"))
    await l.click();
await sleep(600);
check(await setMuted(A, false), "unmute from the row menu");
await mention(B, aName, "and a mention");
check(
  await generalHas(A, ".channel-badge"),
  "after unmuting, the channel row badges the mention",
);
check(
  (await A.$(".space-rail-list .space-pill .pill-badge")) !== null,
  "and so does the space pill",
);

// B (a member) gets Mute only, nothing to manage.
await B.hover(".channel-row");
await B.click(".channel-row .dots-menu-button");
await sleep(300);
check(
  (
    await B.$$eval(".dots-menu button", (es) => es.map((e) => e.textContent))
  ).join(",") === "Mute",
  "member's channel menu: Mute only",
);
await B.keyboard.press("Escape");

// A muted DM: the DMs pill stays clean, activity still hears about it.
for (const row of await A.$$(".member-row")) {
  if ((await row.evaluate((e) => e.textContent)).includes(bName)) {
    await row.click();
    break;
  }
}
await sleep(600);
await A.click(".user-card .message-button");
await sleep(1500);
await A.type(".composer textarea", "starting a thread");
await A.keyboard.press("Enter");
await sleep(1000);
check(await setMuted(A, true), "mute the conversation from the DM row menu");
// Clear everything so the pills below can only be about the muted DM.
await A.goto(`${base}/activity`, { waitUntil: "networkidle0" });
await sleep(1200);
await markAllRead(A);
check(
  (await A.$(".space-pill.activity .pill-dot")) === null,
  "the activity pill starts clean",
);
await A.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(500);
await B.click(".space-pill.dms");
await sleep(1500);
await B.type(".composer textarea", "you there?");
await B.keyboard.press("Enter");
await sleep(1500);
check(
  (await A.$(".space-pill.dms .pill-badge")) === null &&
    (await A.$(".space-pill.dms .pill-dot")) === null,
  "a message in a muted DM raises nothing on the DMs pill",
);
check(
  (await A.$(".space-pill.activity .pill-dot")) !== null,
  "but the activity pill is dotted for it",
);

// A fresh tab that never opens the space (STOOP-138). Its channel list is
// cold, so the mute can only come from the server's stamp on the item.
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1000);
await A.click(".space-rail-list .space-pill");
await sleep(1000);
check(await setMuted(A, true), "mute #general again for the cold-cache case");
await A.goto(`${base}/activity`, { waitUntil: "networkidle0" });
await sleep(1000);
await markAllRead(A);

const A2 = await A.browserContext().newPage();
A2.on("pageerror", (e) => {
  console.log("[A2 pageerror]", e.message);
  fails++;
});
// Headless Chrome can't show native notifications; record what the app
// tries to show instead.
await A.browserContext().overridePermissions(base, ["notifications"]);
await A2.evaluateOnNewDocument(() => {
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
await A2.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(1500);

const clickChannel = async (page, name) => {
  for (const l of await page.$$(".channel-link"))
    if ((await l.evaluate((e) => e.innerText)).includes(name)) {
      await l.click();
      return;
    }
};
const notes = () => A2.evaluate(() => window.__notes.length);

await B.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1200);
await B.click(".space-rail-list .space-pill");
await sleep(1200);
await clickChannel(B, "general");
await sleep(800);
await mention(B, aName, "cold cache, muted");
check(
  (await A2.$(".space-rail-list .space-pill .pill-badge")) === null,
  "a mention in a muted channel raises no space badge on a tab that never opened the space",
);
check(
  (await A2.$(".space-pill.activity .pill-dot")) !== null,
  "and the activity pill is dotted for it all the same",
);
check((await notes()) === 0, "and no desktop banner fires for it");

// The control: the same tab, an unmuted channel, banner and badge both.
await clickChannel(B, "random");
await sleep(800);
await mention(B, aName, "cold cache, unmuted");
check((await notes()) === 1, "an unmuted channel does fire the banner");
check(
  (await A2.$(".space-rail-list .space-pill .pill-badge")) !== null,
  "and badges the space pill",
);

// ---- Muting a whole space (STOOP-135) ----

// The space menu in the sidebar header, and the item it offers.
const spaceMenu = async (page) => {
  await page.click(".sidebar-header .dots-menu-button");
  await page.waitForSelector(".dots-menu button", { timeout: 3000 });
  return await page.$$eval(".dots-menu button", (es) =>
    es.map((e) => e.textContent.trim()),
  );
};
const pickSpaceMenu = async (page, label) => {
  await spaceMenu(page);
  for (const b of await page.$$(".dots-menu button")) {
    if ((await b.evaluate((e) => e.textContent.trim())) === label) {
      await b.click();
      await sleep(800);
      return true;
    }
  }
  await page.keyboard.press("Escape");
  return false;
};

// A2 was opened in front of A, and Chrome throttles a background tab hard
// enough that puppeteer's click (which scrolls the element into view) never
// returns. Everything below drives A again, so give it the foreground; A2
// is only read from, and a banner fires whether or not its tab is visible.
await A.bringToFront();

// Start from a clean slate: #general unmuted, so everything below is the
// space's doing.
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1000);
await A.click(".space-rail-list .space-pill");
await sleep(1200);
check(await setMuted(A, false), "unmute #general so only the space mutes");

check(
  (await spaceMenu(A)).join(",") ===
    "About this space,Invite people,Space settings,Mute space",
  "owner's space menu offers Mute space after Space settings",
);
await A.keyboard.press("Escape");
await sleep(200);
check(await pickSpaceMenu(A, "Mute space"), "mute the space from its menu");
check(
  (await spaceMenu(A)).includes("Unmute space"),
  "and the item flips to Unmute space",
);
await A.keyboard.press("Escape");
await sleep(200);

// The space's own surfaces.
check(
  (await A.$(".sidebar-header .space-muted-icon")) !== null,
  "a muted bell appears beside the space name",
);
check(
  (await A.$eval(".sidebar-header .space-muted-icon", (e) =>
    e.getAttribute("aria-label"),
  )) === "Muted",
  "and it says Muted",
);
check(
  (await A.$(".space-rail-list .space-pill.muted")) !== null,
  "the space pill is dimmed",
);
check(
  await A.$$eval(".channel-list .channel-link", (es) =>
    es.every((e) => e.classList.contains("muted")),
  ),
  "and every channel row under it is dimmed",
);

// A channel cannot be louder than its space.
await A.hover(".channel-row");
await A.click(".channel-row .dots-menu-button");
await sleep(300);
check(
  (
    await A.$$eval(".dots-menu button", (es) => es.map((e) => e.textContent))
  )[0] === "Muted by space",
  "the channel menu's first item reads Muted by space",
);
check(
  (await A.$eval(".dots-menu button", (e) =>
    e.getAttribute("aria-disabled"),
  )) === "true",
  "and it is disabled",
);
await A.keyboard.press("Escape");
await sleep(200);

// The other tab in the same context followed the mute over the wire.
check(
  (await A2.$(".space-rail-list .space-pill.muted")) !== null,
  "a second tab follows the space mute without a reload",
);

// Nothing in a muted space interrupts. A sits on its profile so nothing
// is read on arrival.
await A.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(1000);
await A.click(".space-pill.activity");
await sleep(1200);
await markAllRead(A);
await A.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(800);
const notesBefore = await notes();

await clickChannel(B, "general");
await sleep(800);
await B.type(".composer textarea", "quiet in here");
await B.keyboard.press("Enter");
await sleep(1500);
check(
  (await A.$(".space-rail-list .space-pill .pill-dot")) === null,
  "a plain message in a muted space raises no unread dot",
);

await mention(B, aName, "muted space mention");
check(
  (await A.$(".space-rail-list .space-pill .pill-badge")) === null,
  "a mention there raises no badge on the space pill",
);
check(
  (await A.$(".space-pill.activity .pill-dot")) !== null,
  "but it does light the activity pill's dot",
);
check((await notes()) === notesBefore, "and fires no desktop banner");

// Unmuting gives everything back.
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1000);
await A.click(".space-rail-list .space-pill");
await sleep(1200);
check(await pickSpaceMenu(A, "Unmute space"), "unmute the space from its menu");
check(
  (await A.$(".sidebar-header .space-muted-icon")) === null,
  "the muted bell goes",
);
check(
  (await A.$(".space-rail-list .space-pill.muted")) === null,
  "and the pill is no longer dimmed",
);
await A.hover(".channel-row");
await A.click(".channel-row .dots-menu-button");
await sleep(300);
check(
  (
    await A.$$eval(".dots-menu button", (es) => es.map((e) => e.textContent))
  )[0] === "Mute",
  "the channel menu offers Mute again",
);
await A.keyboard.press("Escape");
await sleep(200);

// Park somewhere else so the mention below stays unread.
await clickChannel(A, "random");
await sleep(800);
await clickChannel(B, "general");
await sleep(800);
await mention(B, aName, "and the badges are back");
check(
  await generalHas(A, ".channel-badge"),
  "after unmuting the space, the channel row badges the mention again",
);
check(
  (await A.$(".space-rail-list .space-pill .pill-badge")) !== null,
  "and so does the space pill",
);

// ---- Profile → Notifications lists every mute (STOOP-136) ----

// A second space, so there is a channel mute that isn't under the muted
// space; A lands in it, and its #general is the one muted.
await A.click('button[title="Create a space"]');
await acceptDialog(A, "Book club");
await sleep(1800);
check(await setMuted(A, true), "mute #general in the second space");

// Back to Stoop HQ: mute #general there too, then the whole space. The
// channel mute is then covered by the space and shouldn't be listed.
await A.click(".space-rail-list .space-pill");
await sleep(1500);
check(await setMuted(A, true), "mute #general in the first space");
check(await pickSpaceMenu(A, "Mute space"), "then mute the space itself");

// A row's label and its note ("direct message"), which sit in two
// columns of the list.
const muteLabels = () =>
  A.$$eval(".mute-list .mute-row", (rows) =>
    rows.map((r) =>
      [r.querySelector(".mute-label"), r.querySelector(".user-cell")]
        .map((e) => e?.innerText.trim() ?? "")
        .join(" ")
        .trim(),
    ),
  );
const unmuteRow = async (label) => {
  for (const row of await A.$$(".mute-row")) {
    if ((await row.$eval(".mute-label", (e) => e.innerText)).includes(label)) {
      await (await row.$("button")).click();
      await sleep(1000);
      return true;
    }
  }
  return false;
};

await A.goto(`${base}/profile?tab=notifications`, {
  waitUntil: "networkidle0",
});
await sleep(1500);
const listed = await muteLabels();
check(
  listed.length === 3 &&
    listed[0] === "Stoop HQ" &&
    listed[1] === "Book club › # general" &&
    listed[2].includes(bName) &&
    listed[2].includes("direct message"),
  `the tab lists the space, the other space's channel and the DM (${listed.join(" | ")})`,
);
check(
  !listed.some((l) => l.startsWith("Stoop HQ ›")),
  "and not the channel inside the muted space, which its row covers",
);

// Unmuting the space clears it and reveals the channel mute underneath.
check(await unmuteRow("Stoop HQ"), "Unmute the space from the list");
check(
  (await A.$(".space-rail-list .space-pill.muted")) === null,
  "the space pill is no longer dimmed",
);
const revealed = await muteLabels();
check(
  revealed.length === 3 && revealed[0] === "Stoop HQ › # general",
  `and the channel mute under it is listed now (${revealed.join(" | ")})`,
);

// Empty once nothing is muted.
check(await unmuteRow("Stoop HQ ›"), "Unmute the channel");
check(await unmuteRow("Book club"), "Unmute the other space's channel");
check(await unmuteRow(bName), "Unmute the conversation");
check(
  (await A.$(".mute-list")) === null &&
    (await A.$eval(".mutes-section", (e) => e.innerText)).includes(
      "You haven't muted anything.",
    ),
  "with nothing muted the card says so",
);

await browser.close();
console.log(fails ? `${fails} failure(s)` : "all passed");
process.exit(fails ? 1 : 0);

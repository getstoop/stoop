// A channel says what it is: the topic in its header, the tooltips that
// carry it, About this channel, and who may write it (STOOP-114).
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
  await p.setViewport({ width: 1280, height: 900 });
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const menuLabels = (p) =>
  p.$$eval(".dots-menu button", (es) => es.map((e) => e.textContent.trim()));

// The ⋮ is fixed to the viewport and closes on any scroll, and puppeteer
// scrolls before it clicks — scroll first, let that event pass, then open.
const openMenu = async (p) => {
  const button = await p.$(".channel-row .dots-menu-button");
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

// Long enough to overflow a 1280px header, which is the case the
// truncation exists for, and near the 250-character cap.
const TOPIC =
  "Borrow anything on the shelf — sign it out here, say what you took, and have it back within a week so the next person is not left waiting. Ladders live in the yard, not the hallway. The chainsaw needs Marguerite.";
const SECOND = "Shelf is full. Please take something.";

// ---- A: set the instance up and land in the space's first channel
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
await sleep(1200);
await A.waitForSelector(".composer textarea", { timeout: 8000 });

// ---- The empty state is an invitation, and only for someone who can act
check(
  (await text(A, ".channel-topic.empty")) === "Add a topic",
  "a manager with no topic set is invited to add one",
);
check((await A.$(".channel-topic-rule")) !== null, "the divider comes with it");

// ---- Setting it from the header
await A.click(".channel-topic.empty");
await acceptDialog(A, TOPIC);
await sleep(600);
check(
  (await text(A, ".channel-header .channel-topic")) === TOPIC,
  "the header carries the topic once saved",
);

// A spec cannot see an ellipsis, so measure it: the box holds one line
// of text and the content is wider than the box.
const line = await A.evaluate(() => {
  const el = document.querySelector(".channel-header .channel-topic");
  if (!el) return null;
  const s = getComputedStyle(el);
  const pad =
    Number.parseFloat(s.paddingTop) + Number.parseFloat(s.paddingBottom);
  return {
    overflows: el.scrollWidth > el.clientWidth,
    content: el.clientHeight - pad,
    lineHeight: Number.parseFloat(s.lineHeight) || el.clientHeight,
    nowrap: s.whiteSpace === "nowrap",
    ellipsis: s.textOverflow === "ellipsis",
    weight: s.fontWeight,
  };
});
check(
  line?.nowrap &&
    line.ellipsis &&
    line.overflows &&
    line.content <= line.lineHeight + 1,
  `the topic is one truncated line (content=${line?.content}, lh=${line?.lineHeight}, overflow=${line?.overflows})`,
);
check(
  line?.weight === "400",
  `the topic is lighter than the name it follows (weight ${line?.weight})`,
);

// ---- Hover reads it in full; click opens About
const topicEl = await A.$(".channel-header .channel-topic");
const box = await topicEl.boundingBox();
await A.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 });
await sleep(700);
check(
  (await text(A, ".tooltip")).includes("The chainsaw needs Marguerite."),
  "hovering the header spells the whole topic out",
);
await A.mouse.move(box.x + 500, box.y + 400);
await sleep(300);

await A.click(".channel-header .channel-topic");
await A.waitForSelector(".channel-about", { timeout: 3000 });
const about = await text(A, ".channel-about");
check(
  about.includes(TOPIC) && about.includes("Text channel"),
  `About this channel shows the topic in full ("${about.replace(/\n/g, " / ")}")`,
);
await A.keyboard.press("Escape");
await sleep(300);
check((await A.$(".channel-about")) === null, "Escape closes About");

// ---- The sidebar row now says what the room is before you click it
const row = await A.$(".channel-row .channel-link");
const rowBox = await row.boundingBox();
await A.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2, {
  steps: 4,
});
await sleep(700);
const tip = await text(A, ".tooltip");
check(
  tip.includes("general") && tip.includes("Borrow anything on the shelf"),
  `the sidebar tooltip carries name and topic ("${tip.replace(/\n/g, " / ")}")`,
);
await A.mouse.move(rowBox.x + 600, rowBox.y + 400);
await sleep(300);

// ---- Space settings lists it, and writes it
await A.goto(`${base}/s/${path(A).split("/")[2]}/settings?tab=channels`, {
  waitUntil: "networkidle0",
});
await sleep(900);
check(
  (await text(A, ".user-row")).includes("Borrow anything on the shelf"),
  "the settings row shows the topic under the channel name",
);
await A.goBack({ waitUntil: "networkidle0" });
await sleep(1200);

// ---- B joins: sees the topic, may not write it
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(400);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);
check(
  (await text(B, ".channel-header .channel-topic")) === TOPIC,
  "a member reads the topic in the header",
);
await openMenu(B);
const bItems = await menuLabels(B);
check(
  bItems.includes("About this channel") &&
    !bItems.some((l) => l.includes("topic") && l !== "About this channel"),
  `a member may open About but not edit the topic (${bItems.join(", ")})`,
);
await B.keyboard.press("Escape");
await sleep(300);

// ---- Realtime: the edit lands in B's header with no reload
await openMenu(A);
const aItems = await menuLabels(A);
check(
  aItems.includes("Edit topic"),
  `a manager edits it from the ⋮ (${aItems.join(", ")})`,
);
await menuItem(A, "Edit topic");
await acceptDialog(A, SECOND);
await sleep(1200);
check(
  (await text(B, ".channel-header .channel-topic")) === SECOND,
  "the change reaches everyone else without a reload",
);

// ---- Clearing it puts the invitation back for a manager, and nothing
// at all in front of a member
await openMenu(A);
await menuItem(A, "Edit topic");
await acceptDialog(A, "");
await sleep(1200);
check(
  (await text(A, ".channel-topic.empty")) === "Add a topic",
  "clearing the topic restores the manager's invitation",
);
check(
  (await B.$(".channel-header .channel-topic")) === null,
  "a member is left with the channel name alone",
);

// ---- On a phone the header keeps only the name; the ⋮ still has About
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1000);
await openMenu(A);
await menuItem(A, "Add a topic");
await acceptDialog(A, TOPIC);
await sleep(800);
await A.setViewport({ width: 390, height: 844 });
await sleep(500);
check(
  await A.evaluate(() => {
    const el = document.querySelector(".channel-header .channel-topic");
    return !el || getComputedStyle(el).display === "none";
  }),
  "the topic strip is out of a phone's header",
);

await browser.close();
console.log(fails ? `FAILED (${fails})` : "OK");
process.exit(fails ? 1 : 0);

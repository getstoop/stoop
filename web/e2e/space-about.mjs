// A space says what it is: the description under its name and on an
// invite, and the welcome a new member lands on (STOOP-108).
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep, spaceMenu } from "./lib.mjs";

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

const DESCRIPTION =
  "Neighbours between 4th and 7th. Tool library, stoop sales, and the group chat that finally replaced the group text.";
const WELCOME =
  "**Welcome to the block.** A few things worth knowing:\n- **#general** is for anything at all.\n- Be neighbourly.";

// ---- A: set up the instance, then say what the space is
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', `Stoop HQ ${suffix}`);
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.click("button.primary");
await sleep(1200);
const spaceId = path(A).split("/")[2];

check(
  (await A.$(".space-desc")) === null,
  "a space with nothing to say renders no description line",
);

await A.goto(`${base}/s/${spaceId}/settings?tab=about`, {
  waitUntil: "networkidle0",
});
await sleep(800);
const areas = await A.$$(".about-section textarea");
check(areas.length === 2, `About offers a description and a welcome field`);
await areas[0].type(DESCRIPTION);
await areas[1].type(WELCOME);
await sleep(200);
check(
  (await text(A, ".about-section")).includes(`${DESCRIPTION.length} / 200`),
  "the description counts down from 200",
);

// The preview renders the welcome the way a member will see it: the
// asterisks become bold rather than staying on the page.
await A.evaluate(() =>
  [...document.querySelectorAll(".about-section .chip")]
    .find((b) => b.textContent === "Preview")
    ?.click(),
);
await sleep(400);
const preview = await text(A, ".about-preview");
check(
  preview.includes("Welcome to the block.") && !preview.includes("**"),
  `preview renders the markdown ("${preview.split("\n")[0]}")`,
);
await A.evaluate(() =>
  [...document.querySelectorAll(".about-section .chip")]
    .find((b) => b.textContent === "Write")
    ?.click(),
);
await sleep(200);

await A.evaluate(() =>
  [...document.querySelectorAll(".about-section button")]
    .find((b) => b.textContent === "Save changes")
    ?.click(),
);
await sleep(1200);
check(
  (await text(A, ".about-section")).includes("Saved"),
  "About saves both fields",
);

// ---- The sidebar line: one line, cut off, and it opens the dialog
await A.goto(`${base}/s/${spaceId}`, { waitUntil: "networkidle0" });
await sleep(1500);
// The welcome pane stands between the space and its first channel the
// first time; step through it.
check(
  (await A.$(".space-welcome")) !== null,
  "the owner's own first visit lands on the welcome",
);
await A.evaluate(() =>
  [...document.querySelectorAll(".space-welcome button")]
    .find((b) => b.textContent.startsWith("Go to"))
    ?.click(),
);
await sleep(1200);

// A spec cannot see truncation, so measure it: the line must stay one
// line high while its content overflows the box.
const line = await A.evaluate(() => {
  const el = document.querySelector(".space-desc");
  if (!el) return null;
  const s = getComputedStyle(el);
  return {
    overflows: el.scrollWidth > el.clientWidth,
    height: el.clientHeight,
    lineHeight: Number.parseFloat(s.lineHeight) || el.clientHeight,
    nowrap: s.whiteSpace === "nowrap",
    text: el.textContent,
  };
});
check(
  line !== null && line.text === DESCRIPTION,
  "the sidebar carries the description",
);
check(
  line?.nowrap && line.overflows && line.height <= line.lineHeight + 1,
  `the description is one truncated line (h=${line?.height}, lh=${line?.lineHeight}, overflow=${line?.overflows})`,
);

await A.click(".space-desc");
await A.waitForSelector(".space-about", { timeout: 3000 });
const about = await text(A, ".space-about");
check(
  about.includes(DESCRIPTION) && about.includes("Welcome to the block."),
  "About this space shows the description and the welcome in full",
);
check(about.includes("1 member"), `About counts the members ("${about}")`);
await A.keyboard.press("Escape");
await sleep(300);
check((await A.$(".space-about")) === null, "Escape closes About");

// ---- The rail tooltip names the space and what it is
const pill = await A.$(".space-rail-list a");
const box = await pill.boundingBox();
await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
  steps: 4,
});
await sleep(700);
const tip = await text(A, ".tooltip");
check(
  tip.includes(`Stoop HQ ${suffix}`) && tip.includes(DESCRIPTION),
  `the rail tooltip carries name and description ("${tip.replace(/\n/g, " / ")}")`,
);
await A.mouse.move(box.x + 400, box.y + 400);
await sleep(300);
check((await A.$(".tooltip")) === null, "the tooltip closes on leave");

// ---- An invite link, and what a stranger sees before joining
await spaceMenu(A, "Invite people");
await A.waitForSelector(".invite-form", { timeout: 3000 });
await A.click('.invite-form button[type="submit"]');
await A.waitForSelector(".invite-row", { timeout: 3000 });
const code = await A.$eval(".invite-row .invite-code", (e) => e.textContent);
await A.keyboard.press("Escape");
await sleep(300);

const B = await newPage("B");
await B.goto(`${base}/join/${code}`, { waitUntil: "networkidle0" });
await sleep(1200);
check(path(B) === "/login", `the link bounces a stranger to login`);
const hero = await text(B, ".invite-hero");
check(
  hero.includes(`Stoop HQ ${suffix}`) &&
    hero.includes(DESCRIPTION) &&
    hero.includes("1 member") &&
    hero.includes("join as member"),
  `the landing shows the space behind the code ("${hero.replace(/\n/g, " / ")}")`,
);
check(
  !hero.includes("Welcome to the block"),
  "the welcome text is never on the public landing",
);

await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);

// ---- The welcome: once, then never again
check(
  (await B.$(".space-welcome")) !== null,
  `a new member lands on the welcome (${path(B)})`,
);
const welcome = await text(B, ".space-welcome");
check(
  welcome.includes("Welcome to the block.") && !welcome.includes("**"),
  "the welcome renders its markdown",
);
await B.evaluate(() =>
  [...document.querySelectorAll(".space-welcome button")]
    .find((b) => b.textContent.startsWith("Go to"))
    ?.click(),
);
await sleep(1200);
check(
  /^\/s\/[^/]+\/c\/[^/]+$/.test(path(B)),
  `entering the space goes to the first channel (${path(B)})`,
);
const bSpaceId = path(B).split("/")[2];
await B.goto(`${base}/s/${bSpaceId}`, { waitUntil: "networkidle0" });
await sleep(1200);
check(
  (await B.$(".space-welcome")) === null &&
    /^\/s\/[^/]+\/c\/[^/]+$/.test(path(B)),
  `the welcome is not offered a second time (${path(B)})`,
);
// It stays reachable, which is the whole reason it is allowed to go away.
await B.click(".space-desc");
await B.waitForSelector(".space-about", { timeout: 3000 });
check(
  (await text(B, ".space-about")).includes("Welcome to the block."),
  "a member can read the welcome again from About this space",
);

// ---- A plain member may read it but not write it
await B.goto(`${base}/s/${bSpaceId}/settings?tab=about`, {
  waitUntil: "networkidle0",
});
await sleep(1000);
check(
  path(B) === `/s/${bSpaceId}` || (await B.$(".about-section")) === null,
  `a member has no About fields to write (${path(B)})`,
);

await browser.close();
console.log(fails ? `FAILED (${fails})` : "OK");
process.exit(fails ? 1 : 0);

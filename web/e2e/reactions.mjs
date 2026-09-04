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
const clickAction = async (p, index, label) => {
  const rows = await p.$$(".message");
  await rows[index].hover();
  const btns = await rows[index].$$(".message-action");
  for (const b of btns)
    if ((await p.evaluate((e) => e.title, b)) === label) {
      await b.click();
      return;
    }
  throw new Error(`no ${label} on message ${index}`);
};
// The chips on message `index`: [{ emoji, count, mine, title }].
const chipsOf = async (p, index) => {
  const rows = await p.$$(".message");
  return p.evaluate(
    (el) =>
      [...el.querySelectorAll(".reaction-chip")].map((c) => ({
        emoji: c.querySelector(".reaction-emoji").textContent,
        count: Number(c.querySelector(".reaction-count").textContent),
        mine: c.classList.contains("mine"),
        title: c.title,
      })),
    rows[index],
  );
};
const clickChip = async (p, index, emoji) => {
  const rows = await p.$$(".message");
  for (const c of await rows[index].$$(".reaction-chip"))
    if (
      (await p.evaluate(
        (e) => e.querySelector(".reaction-emoji").textContent,
        c,
      )) === emoji
    ) {
      await c.click();
      return;
    }
  throw new Error(`no ${emoji} chip on message ${index}`);
};
const pickerEmoji = (p, section) =>
  p.$$eval(`.emoji-picker .${section} .emoji-option`, (els) =>
    els.map((e) => e.textContent),
  );

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
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

await A.type(".composer textarea", "shipped reactions");
await A.keyboard.press("Enter");
await sleep(800);

// The action is there for everyone, first in the row.
const rowsB = await B.$$(".message");
await rowsB[0].hover();
check(
  (await B.$$eval(".message-action", (els) => els.map((e) => e.title)))[0] ===
    "Add reaction",
  "Add reaction is the first message action",
);

// B opens the picker: no recents yet, the common row is there, picks 👍.
await clickAction(B, 0, "Add reaction");
await B.waitForSelector(".emoji-picker", { timeout: 2000 });
check(
  (await B.$(".emoji-picker .emoji-recent")) === null,
  "no recents at first",
);
check(
  (await pickerEmoji(B, "emoji-common")).includes("👍"),
  "common row includes 👍",
);
const sections = await B.$$eval(".emoji-picker .emoji-section", (els) =>
  els.map((e) => e.textContent),
);
check(
  sections[0] === "Common" && sections.includes("Flags"),
  `full set is grouped below Common (${sections.length} sections)`,
);
check(
  (await pickerEmoji(B, "emoji-all")).length > 1500,
  "the full Unicode set is in the picker",
);
await B.click('.emoji-picker .emoji-common .emoji-option[title="thumbs up"]');
await sleep(800);
check((await B.$(".emoji-picker")) === null, "picker closes after picking");
let chips = await chipsOf(B, 0);
check(
  chips.length === 1 &&
    chips[0].emoji === "👍" &&
    chips[0].count === 1 &&
    chips[0].mine,
  "B sees her own 👍 chip, count 1, highlighted",
);

// A sees it live with B's name in the tooltip, not highlighted.
chips = await chipsOf(A, 0);
check(
  chips.length === 1 &&
    chips[0].emoji === "👍" &&
    chips[0].count === 1 &&
    !chips[0].mine,
  "A sees the chip live with count 1, not highlighted",
);
check(chips[0]?.title.includes(`bea${suffix}`), "tooltip names B");

// A adds the same emoji by clicking the chip: 2, highlighted for A, both named.
await clickChip(A, 0, "👍");
await sleep(800);
chips = await chipsOf(A, 0);
check(
  chips[0]?.count === 2 && chips[0]?.mine,
  "A's click makes it 2 and highlighted",
);
check(
  chips[0]?.title.includes(`bea${suffix}`) &&
    chips[0]?.title.includes(`ada${suffix}`),
  "tooltip names both",
);
chips = await chipsOf(B, 0);
check(
  chips[0]?.count === 2 && chips[0]?.mine,
  "B sees 2, still highlighted for her",
);

// A clicks again: back to 1, no longer A's.
await clickChip(A, 0, "👍");
await sleep(800);
chips = await chipsOf(A, 0);
check(
  chips[0]?.count === 1 && !chips[0]?.mine,
  "A's second click removes hers",
);
chips = await chipsOf(B, 0);
check(chips[0]?.count === 1 && chips[0]?.mine, "B sees 1, still hers");

// Picker search finds an emoji by name; Enter picks the first match.
await clickAction(A, 0, "Add reaction");
await A.waitForSelector(".emoji-picker input", { timeout: 2000 });
await A.type(".emoji-picker input", "rocket");
await sleep(200);
const found = await pickerEmoji(A, "emoji-results");
check(found[0] === "🚀", `search "rocket" finds 🚀 (got ${found.join("")})`);
await A.click(".emoji-picker input", { count: 3 });
await A.type(".emoji-picker input", "flag canada");
await sleep(200);
check(
  (await pickerEmoji(A, "emoji-results"))[0] === "🇨🇦",
  'search "flag canada" finds 🇨🇦 from the generated names',
);
await A.click(".emoji-picker input", { count: 3 });
await A.type(".emoji-picker input", "rocket");
await sleep(200);
await A.keyboard.press("Enter");
await sleep(800);
chips = await chipsOf(B, 0);
check(
  chips.length === 2 && chips.some((c) => c.emoji === "🚀" && c.count === 1),
  "B sees A's 🚀 arrive as a second chip",
);

// The recent row now leads with 🚀 for A, and 👍 for B (separate browsers).
await clickAction(A, 0, "Add reaction");
await A.waitForSelector(".emoji-picker", { timeout: 2000 });
check(
  (await pickerEmoji(A, "emoji-recent"))[0] === "🚀",
  "A's recent row starts with 🚀",
);
await A.keyboard.press("Escape");
await sleep(200);
check((await A.$(".emoji-picker")) === null, "Esc closes the picker");
await clickAction(B, 0, "Add reaction");
await B.waitForSelector(".emoji-picker", { timeout: 2000 });
const recentB = await pickerEmoji(B, "emoji-recent");
check(recentB.length === 1 && recentB[0] === "👍", "B's recent row is just 👍");
// Picking from recents toggles B's 👍 off; the chip goes away for both.
await B.click(".emoji-picker .emoji-recent .emoji-option");
await sleep(800);
chips = await chipsOf(A, 0);
check(
  chips.length === 1 && chips[0].emoji === "🚀",
  "removing the last 👍 drops the chip for A",
);

// Reactions survive a reload (list round-trip).
await A.reload({ waitUntil: "networkidle0" });
await sleep(800);
chips = await chipsOf(A, 0);
check(
  chips.length === 1 && chips[0].emoji === "🚀" && chips[0].mine,
  "reload shows the same chips, highlighted for A",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

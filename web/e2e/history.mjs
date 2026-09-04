// Older history: the timeline opens on the latest page, loads the page
// before it when scrolled to the top without the view jumping, and shows
// "Beginning of #channel" once there is nothing older.
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
  defaultViewport: { width: 1100, height: 700 },
});
const A = await (await browser.createBrowserContext()).newPage();
A.on("pageerror", (e) => {
  console.log("[A pageerror]", e.message);
  fails++;
});
A.on("dialog", (d) => d.accept());
const suffix = String(Date.now() % 1000000);
const count = () => A.$$eval(".message", (els) => els.length);
const waitForCount = async (n, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await count()) >= n) return true;
    await sleep(150);
  }
  return false;
};
const scrollTop = () => A.$eval(".message-list", (e) => e.scrollTop);
const scrollToTop = () =>
  A.$eval(".message-list", (e) => {
    e.scrollTop = 0;
  });
const topOf = (id) =>
  A.evaluate(
    (id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1,
    id,
  );
const oldestText = () =>
  A.$$eval(".message-content .md-lines", (els) => els[0]?.innerText ?? "");

await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
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
await sleep(1500);
const channelId = new URL(A.url()).pathname.split("/")[4];

// Seed 120 messages through the API.
await A.evaluate(async (channelId) => {
  for (let i = 1; i <= 120; i++) {
    await fetch("/stoop.chat.v1.ChatService/SendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, content: `message ${i}` }),
    });
  }
}, channelId);
await A.reload({ waitUntil: "networkidle0" });
await sleep(1200);
check(
  (await count()) === 50,
  `opens on the latest page (${await count()} messages)`,
);
check(
  (await A.$(".history-start")) === null,
  "no beginning marker while there may be more",
);
check(
  (await oldestText()) === "message 71",
  "the oldest loaded message is #71",
);
check((await scrollTop()) > 0, "starts scrolled to the bottom");

// Scroll to the top: the previous page arrives and the message that was
// at the top stays exactly where it was on screen.
await scrollToTop();
await sleep(50);
const anchorId = await A.$eval(".message", (e) => e.id);
const before = await topOf(anchorId);
check(
  await waitForCount(100),
  `second page loaded (${await count()} messages)`,
);
await sleep(300);
const after = await topOf(anchorId);
check(
  Math.abs(after - before) < 3,
  `view stays anchored on the same message (${before.toFixed(0)} → ${after.toFixed(0)})`,
);
check(
  (await oldestText()) === "message 21",
  "the oldest loaded message is now #21",
);

// Again: the rest, and the beginning marker.
await scrollToTop();
check(await waitForCount(120), `third page loaded (${await count()} messages)`);
await sleep(600);
const startText = await A.$eval(".history-start", (e) => e.textContent).catch(
  () => "(none)",
);
check(
  startText.includes("Beginning of #general"),
  `beginning marker names the channel ("${startText}")`,
);
await scrollToTop();
await sleep(800);
check((await count()) === 120, "nothing more is fetched past the beginning");

// Reading history: the pill offers a way back, and someone else's new
// message doesn't yank the view — it counts on the pill instead.
await scrollToTop();
await sleep(400);
check(
  (await A.$eval(".jump-latest", (e) => e.textContent).catch(() => "")) ===
    "Jump to latest ↓",
  "away from the bottom, a 'Jump to latest' pill appears",
);
const B = await (await browser.createBrowserContext()).newPage();
B.on("dialog", (d) => d.accept());
await B.goto(link || `${base}/login`, { waitUntil: "networkidle0" });
await sleep(300);
if (link) {
  await B.click('.invite-choice button[data-mode="register"]').catch(() => {});
  await B.type('input[autocomplete="username"]', `bea${suffix}`);
  await B.type('input[type="password"]', "correct horse battery");
  await B.click('button[type="submit"]');
  await B.waitForSelector(".composer textarea", { timeout: 8000 });
  const topBefore = await scrollTop();
  await B.type(".composer textarea", "hello from bea");
  await B.keyboard.press("Enter");
  await sleep(1000);
  check(
    (await A.$eval(".jump-latest", (e) => e.textContent).catch(() => "")) ===
      "1 new message ↓",
    "someone else's message counts on the pill",
  );
  check(
    Math.abs((await scrollTop()) - topBefore) < 3,
    "…and doesn't move the view",
  );
  await A.click(".jump-latest");
  await sleep(500);
  check(
    (await A.$(".jump-latest")) === null,
    "jumping to latest hides the pill",
  );
  check(
    await A.$eval(
      ".message-list",
      (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40,
    ),
    "…and lands at the bottom",
  );
}

// A new message still lands at the bottom and scrolls into view.
await A.type(".composer textarea", "message 121");
await A.keyboard.press("Enter");
await sleep(800);
check((await count()) >= 121, "live messages still append");
check(
  await A.$eval(
    ".message-list",
    (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40,
  ),
  "a new message scrolls the view to the bottom",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

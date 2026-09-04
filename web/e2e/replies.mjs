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
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const lastQuote = (p) =>
  p
    .evaluate(() => {
      const msgs = document.querySelectorAll(".message");
      return (
        msgs[msgs.length - 1]?.querySelector(".reply-quote")?.innerText ?? ""
      );
    })
    .catch(() => "");
const path = (p) => new URL(p.url()).pathname;

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

await A.type(".composer textarea", "anyone up for pizza?");
await A.keyboard.press("Enter");
await sleep(800);
await A.click(".space-pill.avatar");
await sleep(400); // A looks away so the alert isn't auto-read

// B replies via the hover action.
await B.hover(".message");
await B.click('.message .message-action[title="Reply"]');
await sleep(200);
const bar = await text(B, ".reply-bar");
check(
  bar.includes(`Replying to ada${suffix}`) && bar.includes("pizza"),
  "reply bar shows who and what",
);
await B.type(".composer textarea", "yes! 7pm?");
await B.keyboard.press("Enter");
await sleep(1200);
check((await B.$(".reply-bar")) === null, "reply bar clears after sending");
const quote = await lastQuote(B);
check(
  quote.includes(`ada${suffix}`) && quote.includes("anyone up for pizza?"),
  `reply shows a quote of the original (${JSON.stringify(quote)})`,
);

// A is notified with "replied to you".
check(
  (await A.$(".activity .pill-dot")) !== null,
  "A gets an activity item",
);
await A.click(".activity");
await sleep(800);
check(
  (await text(A, ".activity-row")).includes(
    `bea${suffix} replied to you in #general`,
  ),
  "timeline says 'replied to you'",
);
await A.click(".activity-row.unread");
await sleep(1200);
check((await A.$(".activity .pill-dot")) === null, "opening it clears the badge");

// Clicking the quote jumps to (and flashes) the original.
await A.click(".reply-quote");
await sleep(200);
check(
  (
    await A.$eval(".message.flash", (e) => e.innerText).catch(() => "")
  ).includes("anyone up for pizza?"),
  "clicking the quote flashes the original",
);

// Esc cancels a pending reply; self-reply makes no activity item.
await A.hover(".message");
await A.click('.message .message-action[title="Reply"]');
await sleep(200);
check((await A.$(".reply-bar")) !== null, "Reply opens the bar");
await A.keyboard.press("Escape");
await sleep(200);
check((await A.$(".reply-bar")) === null, "Esc cancels the reply");
await A.hover(".message");
await A.click('.message .message-action[title="Reply"]');
await sleep(200);
await A.type(".composer textarea", "replying to myself");
await A.keyboard.press("Enter");
await sleep(1000);
check(
  (await A.$(".activity .pill-dot")) === null &&
    (await lastQuote(A)).includes("pizza"),
  "self-reply quotes but doesn't notify",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

// Windowed history (STOOP-57): jumping to a message that isn't loaded
// replaces the timeline with one page around it; scrolling down pages
// forward until the window is live again; the DOM never holds more than
// WINDOW_CAP rows; arrivals while windowed count on the pill; ?m= deep
// links open around a message.
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

const SEED = 600;
const CAP = 300;
let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  defaultViewport: { width: 1100, height: 700 },
  // This spec pages through far more history than the others, and a CI
  // runner is slower than a dev machine; the default 180 s is thin.
  protocolTimeout: 300_000,
});
const A = await (await browser.createBrowserContext()).newPage();
A.on("pageerror", (e) => {
  console.log("[A pageerror]", e.message);
  fails++;
});
A.on("dialog", (d) => d.accept());
const suffix = String(Date.now() % 1000000);
const count = () => A.$$eval(".message", (els) => els.length);
const texts = () =>
  A.$$eval(".message-content .md-lines", (els) => els.map((e) => e.innerText));
const scrollTop = () => A.$eval(".message-list", (e) => e.scrollTop);
const scrollToBottom = () =>
  A.$eval(".message-list", (e) => {
    e.scrollTop = e.scrollHeight;
  });
const pill = () =>
  A.$eval(".jump-latest", (e) => e.textContent).catch(() => "(none)");
const has = (sel) => A.$(sel).then((h) => h !== null);
const waitFor = async (fn, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
// The seeded quote sits on the newest message (the foot row is the list's
// last child, so :last-of-type won't find it).
const clickLastQuote = () =>
  A.evaluate(() =>
    [...document.querySelectorAll(".message .reply-quote")].at(-1)?.click(),
  );
const centred = (id) =>
  A.evaluate((id) => {
    const el = document.getElementById(`msg-${id}`);
    const list = document.querySelector(".message-list");
    if (!el || !list) return false;
    const r = el.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return r.top >= l.top && r.bottom <= l.bottom;
  }, id);

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
const [, , spaceId, , channelId] = new URL(A.url()).pathname.split("/");

// Seed SEED messages; the last one quotes #5 so a reply jump has to leave
// the loaded window far behind.
//
// From Node with the page's session cookie, not through the page: 600
// fetches issued from inside the browser each cost a CDP round trip, and
// the open timeline re-rendered on every arrival — close to four minutes
// on a GitHub runner, a fifth of the whole suite. Numbering must stay in
// order (the spec reads back "message N"), so the sends are still
// sequential; parking the page on about:blank spares it the broadcasts.
const channelUrl = A.url();
const cookie = (await A.cookies())
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");
await A.goto("about:blank");
const ids = [];
for (let i = 1; i <= SEED; i++) {
  const res = await fetch(`${base}/stoop.chat.v1.ChatService/SendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      channelId,
      content: `message ${i}`,
      // The quoted message is long since sent by the time the last one is.
      replyToMessageId: i === SEED ? ids[4] : "",
    }),
  });
  if (!res.ok) throw new Error(`seeding message ${i}: HTTP ${res.status}`);
  ids.push((await res.json()).message.id);
}
await A.goto(channelUrl, { waitUntil: "networkidle0" });
await sleep(1200);
check((await count()) === 50, `opens on the latest page (${await count()})`);

// Jump to the quoted message: one window around it, nothing else.
await clickLastQuote();
check(
  await waitFor(() => has(`#msg-${ids[4]}`)),
  "the quoted message is loaded after one jump",
);
await sleep(300);
const n1 = await count();
check(n1 < 50, `…as a window around it, not the whole history (${n1} rows)`);
check(
  (await texts())[0] === "message 1",
  "the window starts at the channel's beginning",
);
check(await has(".history-start"), "…and says so");
check(await centred(ids[4]), "the quoted message is on screen");
check(
  (await pill()) === "Jump to latest ↓",
  "a 'Jump to latest' pill is offered while the window isn't live",
);

// Paging forward: scroll to the window's end until it's live. Along the
// way the DOM stays capped and the beginning marker goes away as the
// oldest rows are pruned.
let maxRows = 0;
let lastText = "";
for (let i = 0; i < 20; i++) {
  await scrollToBottom();
  await sleep(600);
  const n = await count();
  maxRows = Math.max(maxRows, n);
  const t = await texts();
  lastText = t[t.length - 1];
  if (lastText === `message ${SEED}`) break;
}
check(
  lastText === `message ${SEED}`,
  `scrolled forward to the newest message (last: ${lastText})`,
);
check(
  maxRows <= CAP,
  `the timeline never held more than ${CAP} rows (max ${maxRows})`,
);
check(maxRows === CAP, `…and did reach the cap (${maxRows})`);
check(
  !(await has(".history-start")),
  "the beginning marker is gone once the oldest rows were pruned",
);
// The last page is appended below the anchored view, so the pill still
// offers the way down; scrolling there dismisses it.
await scrollToBottom();
check(
  await waitFor(async () => (await pill()) === "(none)"),
  "the pill disappears once the window is live and at the bottom",
);

// Windowed again while someone else talks: their message counts on the
// pill and the view doesn't move; the pill brings back the newest page.
await clickLastQuote();
check(await waitFor(() => has(`#msg-${ids[4]}`)), "jumped back into history");
await sleep(300);
const B = await (await browser.createBrowserContext()).newPage();
B.on("dialog", (d) => d.accept());
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.click('.invite-choice button[data-mode="register"]').catch(() => {});
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
const topBefore = await scrollTop();
const rowsBefore = await count();
await B.type(".composer textarea", "hello from bea");
await B.keyboard.press("Enter");
await sleep(1000);
check(
  (await pill()) === "1 new message ↓",
  `someone else's message counts on the pill ("${await pill()}")`,
);
check((await count()) === rowsBefore, "…is not spliced into the window");
check(
  Math.abs((await scrollTop()) - topBefore) < 3,
  "…and doesn't move the view",
);
await A.click(".jump-latest");
check(
  await waitFor(async () => {
    const t = await texts();
    return t[t.length - 1] === "hello from bea";
  }),
  "the pill fetches the newest page",
);
await sleep(300);
check((await count()) <= 51, `…as one page (${await count()} rows)`);
check(
  await A.$eval(
    ".message-list",
    (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40,
  ),
  "…scrolled to the bottom",
);
check((await pill()) === "(none)", "…and the pill is gone");

// Sending from inside history lands the message at the bottom, live.
await A.click(".message:last-of-type .reply-quote").catch(() => {});
// (bea's message has no quote; jump via the seeded one instead)
await A.evaluate(
  (id) =>
    document
      .getElementById(`msg-${id}`)
      ?.querySelector(".reply-quote")
      ?.click(),
  ids[SEED - 1],
);
check(
  await waitFor(() => has(`#msg-${ids[4]}`)),
  "jumped into history once more",
);
await A.type(".composer textarea", "back to now");
await A.keyboard.press("Enter");
check(
  await waitFor(async () => {
    const t = await texts();
    return t[t.length - 1] === "back to now";
  }),
  "sending from inside history returns to the newest page",
);
await sleep(300);
check(
  await A.$eval(
    ".message-list",
    (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40,
  ),
  "…with the sent message in view",
);

// Deep link: ?m= opens the channel around the message and then drops the param.
await A.goto(`${base}/s/${spaceId}/c/${channelId}?m=${ids[299]}`, {
  waitUntil: "networkidle0",
});
check(
  await waitFor(() => has(`#msg-${ids[299]}`)),
  "?m= opens the channel with the message loaded",
);
await sleep(400);
check(await centred(ids[299]), "…on screen");
check((await count()) <= 50, `…in one window (${await count()} rows)`);
check(
  !new URL(A.url()).searchParams.has("m"),
  "…and the param is dropped from the URL",
);
// A bogus id falls back to the newest page rather than an empty timeline.
await A.goto(
  `${base}/s/${spaceId}/c/${channelId}?m=00000000-0000-7000-8000-000000000000`,
  { waitUntil: "networkidle0" },
);
await sleep(800);
const t = await texts();
check(
  t[t.length - 1] === "back to now",
  "an unknown ?m= falls back to the newest page",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

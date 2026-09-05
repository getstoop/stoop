// Message search (STOOP-87): the header launcher, the results page and
// its chips, opening a result in place, and the phone's icon.
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
const newPage = async (tag, viewport = { width: 1280, height: 900 }) => {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport(viewport);
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  return p;
};
const suffix = String(Date.now() % 1000000);
const url = (p) => new URL(p.url());
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const rows = (p) =>
  p.$$eval(".search-row .search-row-body", (es) => es.map((e) => e.innerText));
const say = async (p, msg) => {
  await p.type(".composer textarea", `${msg}\n`);
  await sleep(500);
};
// A search from the header field of whichever channel p is in.
const searchFromHeader = async (p, q) => {
  await p.$eval(".search-launch input", (e) => e.focus());
  await p.keyboard.type(q);
  await p.keyboard.press("Enter");
  await p.waitForSelector(".search-page", { timeout: 5000 });
  await sleep(700);
};

// ---- A: fresh instance, a second channel, an invite for B
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (url(A).pathname !== "/setup") throw new Error("need a fresh instance");
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
await sleep(1200);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const spaceId = url(A).pathname.split("/")[2];
const generalId = url(A).pathname.split("/")[4];

await A.click(".channel-group-heading .channel-add:not(.voice)");
await acceptDialog(A, "garden");
await sleep(800);

const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);
await B.waitForSelector(".composer textarea", { timeout: 8000 });

// ---- Three messages with a shared word, across two channels and two
// people, oldest first.
await say(A, "Restarted the LiveKit container at 3am");
await say(B, "anyone else get a LiveKit token error?");
const gardenHref = await A.$$eval(".channel-link", (es) =>
  es
    .find((e) => e.querySelector(".channel-name")?.textContent === "garden")
    ?.getAttribute("href"),
);
await A.goto(`${base}${gardenHref}`, { waitUntil: "networkidle0" });
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const gardenId = url(A).pathname.split("/")[4];
check(gardenId !== generalId, "A moved to #garden");
await say(A, "tomatoes are in, LiveKit is not");

// ---- The header field opens the results page with the words
check(
  (await A.$(".channel-header .search-launch input")) !== null,
  "a space channel's header carries the search field",
);
await searchFromHeader(A, "livekit");
check(
  url(A).pathname === `/s/${spaceId}/search` &&
    url(A).searchParams.get("q") === "livekit" &&
    url(A).searchParams.get("c") === gardenId,
  `Enter opens the results route with the query and the origin channel (${url(A).pathname}${url(A).search})`,
);
check(
  (await text(A, ".search-count")) === "3 messages",
  `the count reads 3 messages (${await text(A, ".search-count")})`,
);
let found = await rows(A);
check(
  found.length === 3 && /tomatoes/.test(found[0]) && /Restarted/.test(found[2]),
  `three results, newest first (${found.map((r) => r.slice(0, 12)).join(" | ")})`,
);
check(
  (
    await A.$$eval(".search-row mark.search-hit", (es) =>
      es.map((e) => e.textContent),
    )
  ).every((t) => t === "LiveKit"),
  "the matched word is marked in every row",
);
check(
  (await A.$eval(".search-form input", (e) => e.value)) === "livekit",
  "the results field keeps the query",
);
const firstTitle = await text(A, ".search-row .search-row-title");
check(
  /in #general/.test(firstTitle) || /in #garden/.test(firstTitle),
  `a row names its channel (${firstTitle})`,
);

// ---- Prefix on the last word
await A.$eval(".search-form input", (e) => {
  e.focus();
  e.select();
});
await A.keyboard.type("restart");
await A.keyboard.press("Enter");
await sleep(700);
found = await rows(A);
check(
  found.length === 1 && /Restarted/.test(found[0]),
  `"restart" finds "Restarted" through the prefix (${found.length})`,
);

// ---- The scope chips write in:#channel into the query
await A.goto(`${base}/s/${spaceId}/search?q=livekit&c=${generalId}`, {
  waitUntil: "networkidle0",
});
await sleep(700);
check(
  (await A.$$(".search-scope .chip")).length === 2 &&
    (await A.$eval(".search-scope .chip:first-child", (e) =>
      e.classList.contains("active"),
    )),
  "opened from a channel, All channels is the active chip",
);
await A.click(".search-scope .chip:nth-child(2)");
await sleep(700);
check(
  url(A).searchParams.get("q") === "in:#general livekit" &&
    (await A.$eval(".search-form input", (e) => e.value)) ===
      "in:#general livekit",
  `This channel writes in:#general into the query (${url(A).searchParams.get("q")})`,
);
found = await rows(A);
check(
  found.length === 2 && found.every((r) => !/tomatoes/.test(r)),
  `scoped to #general: two results, none from #garden (${found.length})`,
);
await A.click(".search-scope .chip:first-child");
await sleep(700);
check(
  url(A).searchParams.get("q") === "livekit" && (await rows(A)).length === 3,
  "All channels takes the filter back out",
);

// ---- A result opens the channel at that message
// The timeline drops ?m= from the address once it has landed, so the
// flashed row is the evidence.
await A.click(".search-row");
await A.waitForSelector(".message.flash", { timeout: 8000 });
const landed = await text(A, ".message.flash .message-content");
check(
  url(A).pathname === `/s/${spaceId}/c/${gardenId}` && /tomatoes/.test(landed),
  `clicking the newest result lands on it in #garden (${url(A).pathname}, "${landed.slice(0, 20)}")`,
);

// ---- Close returns where the search began; Escape does the same
await A.goto(`${base}/s/${spaceId}/search?q=livekit&c=${generalId}`, {
  waitUntil: "networkidle0",
});
await sleep(500);
await A.click(".search-header .chip");
await sleep(700);
check(
  url(A).pathname === `/s/${spaceId}/c/${generalId}`,
  "Close goes back to the channel the search was opened from",
);
await A.goto(`${base}/s/${spaceId}/search?c=${generalId}`, {
  waitUntil: "networkidle0",
});
await sleep(500);
check(
  await A.evaluate(() => document.activeElement?.matches(".search-form input")),
  "arriving without a query focuses the field",
);
check(
  /Type a word/.test(await text(A, ".search-scroll")),
  "the empty page explains the syntax",
);
await A.keyboard.press("Escape");
await sleep(700);
check(
  url(A).pathname === `/s/${spaceId}/c/${generalId}`,
  "Escape in an empty field closes the page",
);

// ---- Nothing found, and a filter the server refuses
await A.goto(`${base}/s/${spaceId}/search?q=zzzzqqq&c=${generalId}`, {
  waitUntil: "networkidle0",
});
await sleep(700);
check(
  /No messages match zzzzqqq/.test(await text(A, ".search-scroll")),
  "no results says so, with the words",
);
await A.goto(
  `${base}/s/${spaceId}/search?q=before%3Ayesterday+gate&c=${generalId}`,
  { waitUntil: "networkidle0" },
);
await sleep(700);
check(
  /before: wants a date/.test(await text(A, ".search-error")),
  `a bad date filter shows the server's wording (${await text(A, ".search-error")})`,
);

// ---- B sees the same results, including A's messages
await B.goto(`${base}/s/${spaceId}/search?q=livekit&c=${generalId}`, {
  waitUntil: "networkidle0",
});
await sleep(700);
check(
  (await rows(B)).length === 3,
  "another member finds everyone's messages in the space",
);

// ---- Phone: the icon instead of the field, and a tap opens the page
const P = await newPage("P", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await P.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(300);
await P.type('input[autocomplete="username"]', `bea${suffix}`);
await P.type('input[type="password"]', "correct horse battery");
await P.tap('button[type="submit"]');
await sleep(1500);
await P.goto(`${base}/s/${spaceId}/c/${generalId}`, {
  waitUntil: "networkidle0",
});
await P.waitForSelector(".search-launch-button", { timeout: 8000 });
const phone = await P.evaluate(() => ({
  field: getComputedStyle(document.querySelector(".search-launch")).display,
  button: getComputedStyle(document.querySelector(".search-launch-button"))
    .display,
}));
check(
  phone.field === "none" && phone.button !== "none",
  `on a phone the header shows the icon, not the field (${JSON.stringify(phone)})`,
);
await P.tap(".search-launch-button");
await sleep(800);
check(
  url(P).pathname === `/s/${spaceId}/search` &&
    (await P.evaluate(() =>
      document.activeElement?.matches(".search-form input"),
    )),
  "a tap opens the results page with the field focused",
);

await browser.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

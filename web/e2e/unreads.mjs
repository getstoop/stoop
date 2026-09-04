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
const path = (p) => new URL(p.url()).pathname;
const channelLink = async (p, name) => {
  for (const l of await p.$$(".channel-link")) {
    if ((await p.evaluate((e) => e.textContent, l)).includes(name)) return l;
  }
  return null;
};
const isBold = (p, name) =>
  channelLink(p, name).then((l) =>
    p.evaluate((e) => e.classList.contains("unread"), l),
  );
const say = async (p, text) => {
  await p.type(".composer textarea", text);
  await p.keyboard.press("Enter");
  await sleep(600);
};

// A sets up "Stoop HQ" (+ #random), B joins.
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
await A.click(".channel-add");
await acceptDialog(A, "random");
await sleep(1000);
await (await channelLink(A, "random")).click();
await sleep(600);
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

// Fresh channels: nothing bold anywhere.
check(
  !(await isBold(A, "general")) && !(await isBold(A, "random")),
  "A: nothing unread to start",
);
check(
  !(await isBold(B, "general")) && !(await isBold(B, "random")),
  "B: nothing unread to start",
);

// A is in #random; B posts in #general → bold for A, not for B (author).
await say(B, "anyone here?");
await sleep(600);
check(await isBold(A, "general"), "A: #general goes bold when B posts there");
check(
  !(await isBold(B, "general")),
  "B: own message doesn't make #general bold",
);
check(
  (await A.$(".space-rail-list .pill-dot")) !== null,
  "A: the space pill shows a dot while a channel in it is unread",
);

await say(B, "second one");
await sleep(600);

// A opens #general → read; bold clears; the divider sits before the first new message.
await (await channelLink(A, "general")).click();
await sleep(1200);
check(!(await isBold(A, "general")), "A: opening the channel clears bold");
check(
  (await A.$eval(".new-divider", (e) => e.textContent).catch(() => "")) ===
    "New messages" &&
    (await A.$eval(
      ".new-divider",
      (e) =>
        e.nextElementSibling?.querySelector(".message-content")?.textContent,
    ).catch(() => "")) === "anyone here?",
  "A: 'New messages' divider appears before the first unread message",
);
check(
  (
    await A.$$eval(".day-divider", (els) => els.map((e) => e.textContent))
  ).join() === "Today",
  "one day separator, reading 'Today'",
);
check(
  (await A.$eval(".message-time", (e) => e.title)).includes(
    String(new Date().getFullYear()),
  ),
  "timestamps carry the full date on hover",
);

// A message that lands in the channel A is viewing stays read.
await say(B, "still here?");
await sleep(600);
check(
  !(await isBold(A, "general")),
  "A: message in the open channel is read immediately",
);
check(
  (await A.$eval(".new-divider", (e) => e.textContent).catch(() => "")) ===
    "New messages",
  "A: divider stays put while reading",
);
await (await channelLink(A, "random")).click();
await sleep(400);
await (await channelLink(A, "general")).click();
await sleep(800);
check(
  (await A.$(".new-divider")) === null,
  "A: reopening a fully read channel shows no divider",
);

// A posts in #random; B (in #general) sees #random bold; opening it clears.
await (await channelLink(A, "random")).click();
await sleep(600);
await say(A, "psst, random");
await sleep(600);
check(await isBold(B, "random"), "B: #random goes bold");
await (await channelLink(B, "random")).click();
await sleep(1200);
check(!(await isBold(B, "random")), "B: opening #random clears it");

// Space dot: A makes a second space and sits there; B posts in Stoop HQ → dot on A's Stoop HQ pill.
await A.click('button[title="Create a space"]');
await acceptDialog(A, "Second");
await sleep(1500);
await say(B, "over here");
await sleep(800);
check(
  (await A.$(".space-rail-list .pill-dot")) !== null,
  "A: unread dot on the other space's pill",
);
await A.click(".space-rail-list a.space-pill");
await sleep(1500);
check(
  (await A.$(".space-rail-list .pill-dot")) !== null &&
    (await isBold(A, "random")),
  "A: back in Stoop HQ on #general, #random (where B posted) is bold and the dot stays",
);
await (await channelLink(A, "random")).click();
await sleep(1200);
check(
  (await A.$(".space-rail-list .pill-dot")) === null &&
    !(await isBold(A, "random")),
  `A: reading #random clears both (${path(A)})`,
);

// Persistence: B reloads; state survives (server-side marker).
await B.reload({ waitUntil: "networkidle0" });
await sleep(800);
check(
  !(await isBold(B, "random")) && !(await isBold(B, "general")),
  "B: read state survives reload",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

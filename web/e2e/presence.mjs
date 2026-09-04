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
const path = (p) => new URL(p.url()).pathname;
const onlineNames = (p) =>
  p.$$eval(".member-row.online .member-name", (els) =>
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
check(
  (await text(A, ".members-heading")).toLowerCase().includes("1/1 online"),
  "A alone: 1/1 online",
);

// B joins: both sides show two online.
const Bctx = await browser.createBrowserContext();
const B = await Bctx.newPage();
B.on("pageerror", (e) => {
  console.log("[B pageerror]", e.message);
  fails++;
});
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(1000);
check(
  (await text(A, ".members-heading")).toLowerCase().includes("2/2 online") &&
    (await onlineNames(A)).includes(`bea${suffix}`),
  "A sees B come online",
);
check(
  (await text(B, ".members-heading")).toLowerCase().includes("2/2 online"),
  "B's Ready snapshot lists both online",
);

// Typing indicator: B types → A sees it; it expires after B stops.
await B.type(".composer textarea", "thinking about it");
await sleep(600);
check(
  (await text(A, ".typing-indicator")) === `bea${suffix} is typing…`,
  "A sees 'bea is typing…'",
);
check(
  (await text(B, ".typing-indicator")) === "",
  "B doesn't see their own typing",
);
await sleep(5500);
check(
  (await text(A, ".typing-indicator")) === "",
  "typing hint expires after silence",
);
await B.click(".composer textarea", { count: 3 });
await B.keyboard.press("Backspace");

// Profile card shows presence.
await A.click(".member-row.online");
await sleep(600);
check(
  (await text(A, ".user-card")).includes("online"),
  "profile card says online",
);
await A.keyboard.press("Escape");

// @here from the owner: picker offers it; B (online) is notified. A third
// member who is offline is not.
const C = await newPage("C");
await C.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await C.type('input[autocomplete="username"]', `cal${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await C.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);
await C.browserContext().close();
await sleep(1000); // cal goes offline
check(
  (await text(A, ".members-heading")).toLowerCase().includes("2/3 online"),
  "A sees cal offline after closing (2/3 online)",
);
await B.click(".space-pill.avatar");
await sleep(400); // B looks away so the alert isn't auto-read
await A.type(".composer textarea", "@he");
await sleep(300);
check(
  (await text(A, ".mention-picker")).includes("Everyone online right now"),
  "picker offers @here",
);
await A.keyboard.press("Enter");
await A.type(".composer textarea", "standup in 5");
await A.keyboard.press("Enter");
await sleep(1200);
check(
  (await B.$(".activity .pill-dot")) !== null,
  "online member is notified by @here",
);
// cal logs back in: nothing waiting.
const C2 = await newPage("C2");
await C2.goto(`${base}/login`, { waitUntil: "networkidle0" });
await C2.type('input[autocomplete="username"]', `cal${suffix}`);
await C2.type('input[type="password"]', "correct horse battery");
await C2.click('button[type="submit"]');
await sleep(2000);
check(
  (await C2.$(".activity .pill-dot")) === null,
  "offline member was not notified by @here",
);

// B closes: A sees B offline.
await Bctx.close();
await sleep(1000);
check(!(await onlineNames(A)).includes(`bea${suffix}`), "A sees B go offline");

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

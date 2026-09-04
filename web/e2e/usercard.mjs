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
const wire = (p, tag) =>
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
const suffix = String(Date.now() % 1000000);

// A: set up the instance (admin + owner), mint an invite link.
const A = await (await browser.createBrowserContext()).newPage();
wire(A, "A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
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
// A renames themselves so we can verify the card fetches fresh.
await A.click(".space-pill.avatar");
await sleep(500);
await A.click("#display-name", { count: 3 });
await A.type("#display-name", "Ada W.");
await A.click('.card button[type="submit"]');
await sleep(600);
await A.goBack();
await sleep(800);
await A.type(".composer textarea", "hello from the owner");
await A.keyboard.press("Enter");
await sleep(600);

// B joins via the link and says hi.
const B = await (await browser.createBrowserContext()).newPage();
wire(B, "B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `friend${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);
await B.type(".composer textarea", "hi from a member");
await B.keyboard.press("Enter");
await sleep(800);

// B clicks the owner's name.
const authors = await B.$$(".message-author");
await authors[0].click();
await sleep(800);
await B.waitForSelector(".user-card", { timeout: 3000 });
const card = await B.$eval(".user-card", (e) => e.innerText);
check(
  card.includes("Ada W.") && card.includes(`@ada${suffix}`),
  `card shows current display name + handle: ${JSON.stringify(card.split("\n")[0])}`,
);
check(
  /owner/i.test(card) && /server admin/i.test(card),
  "card shows owner + server admin badges",
);
check(/Joined this space/.test(card), "card shows joined date");
await B.keyboard.press("Escape");
await sleep(200);
check((await B.$(".user-card")) === null, "Escape closes the card");

// A clicks the member's name; then clicking elsewhere closes it.
const aAuthors = await A.$$(".message-author");
await aAuthors[aAuthors.length - 1].click();
await sleep(800);
await A.waitForSelector(".user-card", { timeout: 3000 });
const card2 = await A.$eval(".user-card", (e) => e.innerText);
check(
  card2.includes(`@friend${suffix}`) &&
    /member/i.test(card2) &&
    !/server admin/i.test(card2),
  "owner sees member card without admin badges",
);
await A.mouse.click(5, 5);
await sleep(300);
check((await A.$(".user-card")) === null, "outside click closes the card");

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

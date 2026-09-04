import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const suffix = String(Date.now() % 1000000);
let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => console.log(`[${tag} pageerror]`, e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/401|404/.test(m.text()))
      console.log(`[${tag} console]`, m.text());
  });
  return p;
};

const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("need fresh instance");
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

console.log("--- B signs up via the link");
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
console.log(
  "B landed:",
  new URL(B.url()).pathname,
  "status:",
  await B.$eval(".status-icon", (e) => e.className),
);
await A.type(".composer textarea", "msg1 right away");
await A.keyboard.press("Enter");
await sleep(1500);
check(
  (await B.$eval(".message-list", (e) => e.innerText)).includes("msg1"),
  "B sees a message sent right after landing",
);
await sleep(4000);
await A.type(".composer textarea", "msg2 after 4s");
await A.keyboard.press("Enter");
await sleep(1500);
check(
  (await B.$eval(".message-list", (e) => e.innerText)).includes("msg2"),
  "B sees a message sent a few seconds later",
);
console.log("--- B reloads");
await B.reload({ waitUntil: "networkidle0" });
await sleep(1500);
await A.type(".composer textarea", "msg3 after reload");
await A.keyboard.press("Enter");
await sleep(1500);
check(
  (await B.$eval(".message-list", (e) => e.innerText)).includes("msg3"),
  "B sees a message after reloading",
);
await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

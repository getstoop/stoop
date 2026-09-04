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
  p.on("dialog", (d) => d.accept());
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const contents = (p) =>
  p.$$eval(".message-content", (els) => els.map((e) => e.innerText.trim()));
const actionsOf = async (p, index) => {
  const rows = await p.$$(".message");
  await rows[index].hover();
  return p.evaluate(
    (el) => [...el.querySelectorAll(".message-action")].map((b) => b.title),
    rows[index],
  );
};
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

await B.type(".composer textarea", "helo wrld");
await B.keyboard.press("Enter");
await sleep(600);
await A.type(".composer textarea", "owner here");
await A.keyboard.press("Enter");
await sleep(800);

// Actions visible (Add reaction and Reply for everyone): B (member) sees
// Edit/Delete on her own, not on A's; A (owner) sees Delete on B's.
check(
  JSON.stringify(await actionsOf(B, 0)) ===
    JSON.stringify(["Add reaction", "Reply", "Edit", "Delete"]),
  "member: own message has Reply/Edit/Delete",
);
check(
  JSON.stringify(await actionsOf(B, 1)) ===
    JSON.stringify(["Add reaction", "Reply"]),
  "member: someone else's has only Reply",
);
check(
  JSON.stringify(await actionsOf(A, 0)) ===
    JSON.stringify(["Add reaction", "Reply", "Delete"]),
  "owner: another's message has Reply/Delete (no Edit)",
);

// B edits: inline editor, Enter saves, (edited) marker, A sees it live.
await clickAction(B, 0, "Edit");
await sleep(200);
await B.click(".message-editor textarea", { count: 3 });
await B.type(".message-editor textarea", "hello world");
await B.keyboard.press("Enter");
await sleep(800);
check(
  (await contents(B))[0].startsWith("hello world") &&
    (await B.$(".edited-marker")) !== null,
  "edit saved with (edited) marker",
);
check(
  (await contents(A))[0].startsWith("hello world") &&
    (await A.$(".edited-marker")) !== null,
  "A sees the edit live",
);
// Esc cancels without saving.
await clickAction(B, 0, "Edit");
await sleep(200);
await B.type(".message-editor textarea", " zzz");
await B.keyboard.press("Escape");
await sleep(300);
check(
  (await contents(B))[0].startsWith("hello world") &&
    !(await contents(B))[0].includes("zzz"),
  "Esc cancels an edit",
);

// A replies to B's message, then B deletes hers: A's reply shows "(message deleted)"; list shrinks live for both.
await clickAction(A, 0, "Reply");
await A.type(".composer textarea", "hi bea");
await A.keyboard.press("Enter");
await sleep(800);
await clickAction(B, 0, "Delete");
await acceptDialog(B);
await sleep(1000);
const bc = await contents(B),
  ac = await contents(A);
check(
  !bc.some((c) => c.startsWith("hello world")) &&
    !ac.some((c) => c.startsWith("hello world")),
  "deleted message disappears for both",
);
check(
  (await A.$eval(".reply-quote", (e) => e.innerText)).includes(
    "message deleted",
  ),
  "reply quote shows '(message deleted)'",
);

// Owner deletes B's remaining message? B has none left; owner deletes their own reply.
const before = (await contents(A)).length;
await clickAction(A, before - 1, "Delete");
await acceptDialog(A);
await sleep(800);
check(
  (await contents(A)).length === before - 1 &&
    (await contents(B)).length === before - 1,
  "owner's delete propagates",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

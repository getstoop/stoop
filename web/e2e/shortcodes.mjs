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
const A = await (await browser.createBrowserContext()).newPage();
A.on("pageerror", (e) => {
  console.log("[A pageerror]", e.message);
  fails++;
});
A.on("dialog", (d) => d.accept());
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const draft = () => A.$eval(".composer textarea", (e) => e.value);
const suggestions = () =>
  A.$$eval(".emoji-suggest .mention-option", (els) =>
    els.map((e) => ({
      emoji: e.querySelector(".emoji-suggest-emoji").textContent,
      code: e.querySelector(".muted").textContent,
      selected: e.classList.contains("selected"),
    })),
  );
// The body only (attachments, cards and the edited marker also live in
// .message-content).
const lastMessage = () =>
  A.$$eval(".message-content .md-lines", (els) =>
    els[els.length - 1].innerText.trim(),
  );

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
await A.click("button.primary");
await A.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

// Typing :so opens suggestions; the alias comes first; Enter inserts the emoji.
await A.type(".composer textarea", "oh no :so");
await sleep(150);
let list = await suggestions();
check(
  list.length > 0 && list[0].emoji === "😭" && list[0].code === ":sob:",
  `":so" suggests :sob: first (got ${list.map((s) => s.code).join(" ")})`,
);
check(list[0]?.selected === true, "first suggestion is selected");
await A.keyboard.press("ArrowDown");
await sleep(50);
list = await suggestions();
check(list[1]?.selected === true, "ArrowDown moves the selection");
await A.keyboard.press("ArrowUp");
await A.keyboard.press("Enter");
await sleep(150);
check((await draft()) === "oh no 😭 ", "Enter inserts the emoji and a space");
check((await suggestions()).length === 0, "list closes after picking");
// Enter now sends, and the message carries the real emoji.
await A.keyboard.press("Enter");
await sleep(700);
check((await lastMessage()) === "oh no 😭", "message sent with the emoji");

// Unpicked shortcodes convert on send; unknown ones and times stay put;
// code spans are left alone.
await A.type(
  ".composer textarea",
  "ship it :rocket: :crying: :nope: at 10:30:45 and `:sob:` ",
);
await A.keyboard.press("Escape");
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await lastMessage()) === "ship it 🚀 😢 :nope: at 10:30:45 and :sob:",
  `send converts known shortcodes only (got "${await lastMessage()}")`,
);

// Tab picks too; Esc closes without inserting; a Unicode-derived name works.
await A.type(".composer textarea", ":loudly_cry");
await sleep(150);
list = await suggestions();
check(list[0]?.emoji === "😭", "Unicode-derived names are suggested");
await A.keyboard.press("Escape");
await sleep(50);
check(
  (await suggestions()).length === 0 && (await draft()) === ":loudly_cry",
  "Esc closes the list and keeps the text",
);
await A.type(".composer textarea", "i");
await sleep(150);
await A.keyboard.press("Tab");
await sleep(150);
check((await draft()) === "😭 ", "Tab picks the highlighted suggestion");
await A.keyboard.press("Enter");
await sleep(700);

// Colons in ordinary text don't open the list.
await A.type(".composer textarea", "note: this");
await sleep(150);
check(
  (await suggestions()).length === 0,
  "a colon followed by a space is not a query",
);
await A.keyboard.press("Enter");
await sleep(700);

// Editing converts as well.
const rows = await A.$$(".message");
const last = rows[rows.length - 1];
await last.hover();
// A continued row renders its actions twice (a hidden meta row and the
// hover gutter); click the one that's actually laid out.
for (const b of await last.$$(".message-action"))
  if (
    (await A.evaluate((e) => e.title, b)) === "Edit" &&
    (await b.boundingBox())
  ) {
    await b.click();
    break;
  }
await sleep(200);
await A.$eval(".message-editor textarea", (e) => {
  e.focus();
  e.setSelectionRange(e.value.length, e.value.length);
});
await A.type(".message-editor textarea", " :+1:");
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await lastMessage()).startsWith("note: this 👍"),
  "the inline editor converts on save",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

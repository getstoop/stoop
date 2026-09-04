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
const path = (p) => new URL(p.url()).pathname;
const draft = (p) => p.$eval(".composer textarea", (e) => e.value);
const selectAll = (p) =>
  p.$eval(".composer textarea", (e) => {
    e.focus();
    e.select();
  });
const send = async (p, text) => {
  await p.type(".composer textarea", text);
  await p.keyboard.press("Enter");
  await sleep(700);
};
const lastMessage = (p, selector) =>
  p.$$eval(
    ".message-content",
    (els, sel) => {
      const last = els[els.length - 1];
      const found = sel ? last.querySelector(sel) : last;
      return found ? found.textContent : null;
    },
    selector,
  );
const sendLines = async (p, lines) => {
  await p.$eval(".composer textarea", (e) => e.focus());
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await p.keyboard.down("Shift");
      await p.keyboard.press("Enter");
      await p.keyboard.up("Shift");
    }
    await p.type(".composer textarea", lines[i]);
  }
  await p.keyboard.press("Enter");
  await sleep(800);
};
const clickTool = async (p, label) => {
  await p.click(`.composer .format-button[aria-label="${label}"]`);
  await sleep(100);
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

// Inline syntax renders as real elements, and B sees the same live.
// (The trailing space closes the mention picker so Enter sends.)
await send(
  A,
  `**bold** *it* __under__ ~~gone~~ \`code\` https://example.com/x. @bea${suffix} `,
);
for (const [sel, text] of [
  ["strong", "bold"],
  ["em", "it"],
  ["u", "under"],
  ["s", "gone"],
  ["code.md-code", "code"],
  ["a.md-link", "https://example.com/x"],
  [".mention", `@bea${suffix}`],
]) {
  check((await lastMessage(A, sel)) === text, `renders <${sel}> ${text}`);
}
check(
  (await A.$eval(".message-content a.md-link", (e) => e.target)) === "_blank",
  "links open in a new tab",
);
check((await lastMessage(B, "strong")) === "bold", "B sees the bold live");
check(
  !(await lastMessage(B)).includes("**"),
  "no raw markers in the rendered text",
);

// Toolbar: wraps the selection, toggles off again, and keeps focus.
await A.type(".composer textarea", "hi there");
await selectAll(A);
await clickTool(A, "Bold");
check((await draft(A)) === "**hi there**", "toolbar bold wraps the selection");
check(
  await A.$eval(
    ".composer textarea",
    (e) => document.activeElement === e && e.selectionStart === 2,
  ),
  "textarea keeps focus with the inner text selected",
);
await clickTool(A, "Bold");
check((await draft(A)) === "hi there", "bold again unwraps");
// Shortcuts.
await selectAll(A);
await A.keyboard.down("Control");
await A.keyboard.press("i");
await A.keyboard.up("Control");
await sleep(100);
check((await draft(A)) === "*hi there*", "Ctrl+I italicises");
await selectAll(A);
await A.keyboard.down("Control");
await A.keyboard.down("Shift");
await A.keyboard.press("x");
await A.keyboard.up("Shift");
await A.keyboard.up("Control");
await sleep(100);
check((await draft(A)) === "~~*hi there*~~", "Ctrl+Shift+X strikes");
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await lastMessage(A, "s em")) === "hi there",
  "nested strike/italic renders",
);
// With no selection the markers open around the caret, so what you type
// next is inside them; the same shortcut again with the empty pair removes it.
await A.type(".composer textarea", "say ");
await A.keyboard.down("Control");
await A.keyboard.press("b");
await A.keyboard.up("Control");
await A.type(".composer textarea", "loud");
check(
  (await draft(A)) === "say **loud**",
  "caret-only bold wraps what you type next",
);
await A.keyboard.down("Control");
await A.keyboard.press("b");
await A.keyboard.up("Control");
await A.type(".composer textarea", "er");
check(
  (await draft(A)) === "say **loud**er",
  "the shortcut at the closer moves past it",
);
await A.$eval(".composer textarea", (e) => {
  e.value = "";
});
await A.type(".composer textarea", "a");
await A.keyboard.press("Backspace");
check((await draft(A)) === "", "composer cleared for the next step");

// Quote and code block via the toolbar, multi-line.
await A.type(".composer textarea", "wise words");
await clickTool(A, "Quote");
check((await draft(A)) === "> wise words", "quote prefixes the line");
await A.keyboard.press("End");
await A.keyboard.down("Shift");
await A.keyboard.press("Enter");
await A.keyboard.up("Shift");
await A.type(".composer textarea", "x := 1");
await A.$eval(".composer textarea", (e) => {
  e.setSelectionRange(e.value.length - 6, e.value.length);
});
await clickTool(A, "Code block");
check(
  (await draft(A)) === "> wise words\n```\nx := 1\n```",
  "code block fences the selection on its own lines",
);
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await lastMessage(A, "blockquote.md-quote")) === "wise words" &&
    (await lastMessage(A, "pre.md-pre code")) === "x := 1",
  "quote and code block render",
);

// Lists and spoilers (STOOP-37): toolbar writes them, the timeline renders
// real <ul>/<ol> and a spoiler that stays hidden until it is clicked.
await A.type(".composer textarea", "milk");
await clickTool(A, "Bulleted list");
check((await draft(A)) === "- milk", "the list button prefixes the line");
await A.keyboard.press("End");
await A.keyboard.down("Shift");
await A.keyboard.press("Enter");
await A.keyboard.up("Shift");
await A.type(".composer textarea", "- eggs");
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await A.$$eval(".message-content", (els) =>
    [...els[els.length - 1].querySelectorAll("ul.md-list li")]
      .map((e) => e.textContent)
      .join(","),
  )) === "milk,eggs",
  "a bulleted list renders as a real ul",
);

// Numbered, with bulleted children: each level picks its own tag, and the
// sub-list lives inside the <li> it belongs to (never <li> beside <li>).
await sendLines(A, ["1. first", "  - under", "2. second"]);
const ordered = await A.$$eval(".message-content", (els) => {
  const ol = els[els.length - 1].querySelector("ol.md-list");
  return {
    top: [...ol.children].map((li) => li.firstChild?.textContent),
    nestedTag: ol.querySelector("li > ul, li > ol")?.tagName ?? null,
    nestedText: ol.querySelector("li ul li")?.textContent,
    liInsideLi: !!ol.querySelector("li > li"),
  };
});
check(
  ordered.top.join(",") === "first,second" &&
    ordered.nestedTag === "UL" &&
    ordered.nestedText === "under" &&
    !ordered.liInsideLi,
  `numbered list takes bulleted children inside its item (${JSON.stringify(ordered)})`,
);

// A run that switches marker kind is two lists, not one.
await sendLines(A, ["- a bullet", "1. a number"]);
check(
  (await A.$$eval(".message-content", (els) =>
    [...els[els.length - 1].children].map((c) => c.tagName).join(","),
  )) === "UL,OL",
  "switching marker kind starts a new list",
);
// Switching list style swaps the prefix rather than stacking it.
await A.type(".composer textarea", "- a thing");
await clickTool(A, "Numbered list");
check((await draft(A)) === "1. a thing", "list buttons swap prefixes");
await clickTool(A, "Numbered list");
check((await draft(A)) === "a thing", "clicking the same one again removes it");
await selectAll(A);
await clickTool(A, "Spoiler");
check(
  (await draft(A)) === "||a thing||",
  "the spoiler button wraps the selection",
);
await A.keyboard.press("Enter");
await sleep(700);
const spoiler = ".message-content .md-spoiler";
check(
  (await A.$eval(spoiler, (e) => e.tagName)) === "BUTTON" &&
    (await A.$eval(spoiler, (e) => e.getAttribute("aria-expanded"))) ===
      "false",
  "a spoiler renders as an unrevealed button",
);
check(
  (await A.$eval(spoiler, (e) => getComputedStyle(e).color)) ===
    "rgba(0, 0, 0, 0)",
  "the spoiler's text is not readable before it is clicked",
);
check(
  (await A.$eval(spoiler, (e) => e.textContent)) === "a thing",
  "…though the words are in the DOM for a screen reader once revealed",
);
await A.click(spoiler);
await sleep(200);
check(
  (await A.$eval(spoiler, (e) => e.getAttribute("aria-expanded"))) === "true" &&
    (await A.$eval(spoiler, (e) => getComputedStyle(e).color)) !==
      "rgba(0, 0, 0, 0)",
  "clicking reveals it",
);

// Previews are plain: the reply bar, the reply quote, and B's activity row.
await clickAction(A, 0, "Reply");
await sleep(200);
const bar = await A.$eval(".reply-bar", (e) => e.innerText);
check(
  bar.includes("bold it under gone code") && !bar.includes("**"),
  "reply bar preview is plain text",
);
await send(A, "re: that");
const quote = await A.$eval(".reply-quote .reply-preview", (e) => e.innerText);
check(
  quote.startsWith("bold it under gone") && !quote.includes("**"),
  "reply quote preview is plain text",
);
await B.click('a[href="/activity"]');
await sleep(800);
const preview = await B.$eval(".activity-preview", (e) => e.innerText);
check(
  preview.includes("bold it under gone") && !preview.includes("**"),
  "activity preview is plain text",
);

// Editing shows the raw Markdown and keeps it.
await clickAction(A, 0, "Edit");
await sleep(200);
check(
  (await A.$eval(".message-editor textarea", (e) => e.value)).startsWith(
    "**bold**",
  ),
  "editor shows the raw markup",
);
await A.$eval(".message-editor textarea", (e) => {
  e.focus();
  e.setSelectionRange(e.value.length, e.value.length);
});
await A.type(".message-editor textarea", " edited");
await A.keyboard.press("Enter");
await sleep(700);
check(
  (await A.$eval(".message-content strong", (e) => e.textContent)) === "bold" &&
    (await A.$eval(".message-content", (e) => e.innerText)).includes("edited"),
  "edited message still renders formatting",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

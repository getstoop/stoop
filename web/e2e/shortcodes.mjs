import { harness, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { tokens } = await seed({ users: ["ada"], channels: ["general"] });
const A = await newPage("A");
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
    els.length ? els[els.length - 1].innerText.trim() : "",
  );

await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });

// Typing :so opens suggestions; the alias comes first; Enter inserts the emoji.
await A.type(".composer textarea", "oh no :so");
let list;
check(
  await waitFor(async () => {
    list = await suggestions();
    return (
      list.length > 0 && list[0].emoji === "😭" && list[0].code === ":sob:"
    );
  }),
  `":so" suggests :sob: first (got ${list.map((s) => s.code).join(" ")})`,
);
check(list[0]?.selected === true, "first suggestion is selected");
await A.keyboard.press("ArrowDown");
check(
  await waitFor(async () => {
    list = await suggestions();
    return list[1]?.selected === true;
  }),
  "ArrowDown moves the selection",
);
await sleep(50);
await A.keyboard.press("ArrowUp");
await A.keyboard.press("Enter");
check(
  await waitFor(async () => (await draft()) === "oh no 😭 "),
  "Enter inserts the emoji and a space",
);
check(
  await waitFor(async () => (await suggestions()).length === 0),
  "list closes after picking",
);
await sleep(150);
// Enter now sends, and the message carries the real emoji.
await A.keyboard.press("Enter");
check(
  await waitFor(async () => (await lastMessage()) === "oh no 😭"),
  "message sent with the emoji",
);
await sleep(700);

// Unpicked shortcodes convert on send; unknown ones and times stay put;
// code spans are left alone.
await A.type(
  ".composer textarea",
  "ship it :rocket: :crying: :nope: at 10:30:45 and `:sob:` ",
);
await A.keyboard.press("Escape");
await A.keyboard.press("Enter");
check(
  await waitFor(
    async () =>
      (await lastMessage()) === "ship it 🚀 😢 :nope: at 10:30:45 and :sob:",
  ),
  `send converts known shortcodes only (got "${await lastMessage()}")`,
);

// Tab picks too; Esc closes without inserting; a Unicode-derived name works.
await A.type(".composer textarea", ":loudly_cry");
check(
  await waitFor(async () => {
    list = await suggestions();
    return list[0]?.emoji === "😭";
  }),
  "Unicode-derived names are suggested",
);
await sleep(150);
await A.keyboard.press("Escape");
check(
  await waitFor(
    async () =>
      (await suggestions()).length === 0 && (await draft()) === ":loudly_cry",
  ),
  "Esc closes the list and keeps the text",
);
await A.type(".composer textarea", "i");
await sleep(150);
await A.keyboard.press("Tab");
check(
  await waitFor(async () => (await draft()) === "😭 "),
  "Tab picks the highlighted suggestion",
);
await sleep(150);
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
check(
  await waitFor(async () => (await lastMessage()).startsWith("note: this 👍")),
  "the inline editor converts on save",
);

await done();

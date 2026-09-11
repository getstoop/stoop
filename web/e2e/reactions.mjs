import { harness, reloadShared, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { suffix, tokens } = await seed({ channels: ["general"] });
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
// The chips on message `index`: [{ emoji, count, mine, title }].
const chipsOf = async (p, index) => {
  const rows = await p.$$(".message");
  if (!rows[index]) return [];
  return p.evaluate(
    (el) =>
      [...el.querySelectorAll(".reaction-chip")].map((c) => ({
        emoji: c.querySelector(".reaction-emoji").textContent,
        count: Number(c.querySelector(".reaction-count").textContent),
        mine: c.classList.contains("mine"),
        title: c.title,
      })),
    rows[index],
  );
};
const clickChip = async (p, index, emoji) => {
  const rows = await p.$$(".message");
  for (const c of await rows[index].$$(".reaction-chip"))
    if (
      (await p.evaluate(
        (e) => e.querySelector(".reaction-emoji").textContent,
        c,
      )) === emoji
    ) {
      await c.click();
      return;
    }
  throw new Error(`no ${emoji} chip on message ${index}`);
};
const pickerEmoji = (p, section) =>
  p.$$eval(`.emoji-picker .${section} .emoji-option`, (els) =>
    els.map((e) => e.textContent),
  );

const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });

await A.type(".composer textarea", "shipped reactions");
await A.keyboard.press("Enter");
await sleep(800);

// The action is there for everyone, first in the row.
const rowsB = await B.$$(".message");
await rowsB[0].hover();
check(
  (await B.$$eval(".message-action", (els) => els.map((e) => e.title)))[0] ===
    "Add reaction",
  "Add reaction is the first message action",
);

// B opens the picker: no recents yet, the common row is there, picks 👍.
await clickAction(B, 0, "Add reaction");
await B.waitForSelector(".emoji-picker", { timeout: 2000 });
check(
  (await B.$(".emoji-picker .emoji-recent")) === null,
  "no recents at first",
);
check(
  (await pickerEmoji(B, "emoji-common")).includes("👍"),
  "common row includes 👍",
);
const sections = await B.$$eval(".emoji-picker .emoji-section", (els) =>
  els.map((e) => e.textContent),
);
check(
  sections[0] === "Common" && sections.includes("Flags"),
  `full set is grouped below Common (${sections.length} sections)`,
);
check(
  (await pickerEmoji(B, "emoji-all")).length > 1500,
  "the full Unicode set is in the picker",
);
await B.click('.emoji-picker .emoji-common .emoji-option[title="thumbs up"]');
check(
  await waitFor(async () => (await B.$(".emoji-picker")) === null),
  "picker closes after picking",
);
let chips;
check(
  await waitFor(async () => {
    chips = await chipsOf(B, 0);
    return (
      chips.length === 1 &&
      chips[0].emoji === "👍" &&
      chips[0].count === 1 &&
      chips[0].mine
    );
  }),
  "B sees her own 👍 chip, count 1, highlighted",
);

// A sees it live with B's name in the tooltip, not highlighted.
check(
  await waitFor(async () => {
    chips = await chipsOf(A, 0);
    return (
      chips.length === 1 &&
      chips[0].emoji === "👍" &&
      chips[0].count === 1 &&
      !chips[0].mine
    );
  }),
  "A sees the chip live with count 1, not highlighted",
);
check(chips[0]?.title.includes(`bea${suffix}`), "tooltip names B");

// A adds the same emoji by clicking the chip: 2, highlighted for A, both named.
await clickChip(A, 0, "👍");
check(
  await waitFor(async () => {
    chips = await chipsOf(A, 0);
    return chips[0]?.count === 2 && chips[0]?.mine;
  }),
  "A's click makes it 2 and highlighted",
);
check(
  chips[0]?.title.includes(`bea${suffix}`) &&
    chips[0]?.title.includes(`ada${suffix}`),
  "tooltip names both",
);
check(
  await waitFor(async () => {
    chips = await chipsOf(B, 0);
    return chips[0]?.count === 2 && chips[0]?.mine;
  }),
  "B sees 2, still highlighted for her",
);

// A clicks again: back to 1, no longer A's.
await clickChip(A, 0, "👍");
check(
  await waitFor(async () => {
    chips = await chipsOf(A, 0);
    return chips[0]?.count === 1 && !chips[0]?.mine;
  }),
  "A's second click removes hers",
);
check(
  await waitFor(async () => {
    chips = await chipsOf(B, 0);
    return chips[0]?.count === 1 && chips[0]?.mine;
  }),
  "B sees 1, still hers",
);

// Picker search finds an emoji by name; Enter picks the first match.
await clickAction(A, 0, "Add reaction");
await A.waitForSelector(".emoji-picker input", { timeout: 2000 });
await A.type(".emoji-picker input", "rocket");
let found = [];
check(
  await waitFor(async () => {
    found = await pickerEmoji(A, "emoji-results");
    return found[0] === "🚀";
  }),
  `search "rocket" finds 🚀 (got ${found.join("")})`,
);
await sleep(200);
await A.click(".emoji-picker input", { count: 3 });
await A.type(".emoji-picker input", "flag canada");
check(
  await waitFor(
    async () => (await pickerEmoji(A, "emoji-results"))[0] === "🇨🇦",
  ),
  'search "flag canada" finds 🇨🇦 from the generated names',
);
await A.click(".emoji-picker input", { count: 3 });
await A.type(".emoji-picker input", "rocket");
await sleep(200);
await A.keyboard.press("Enter");
check(
  await waitFor(async () => {
    chips = await chipsOf(B, 0);
    return (
      chips.length === 2 && chips.some((c) => c.emoji === "🚀" && c.count === 1)
    );
  }),
  "B sees A's 🚀 arrive as a second chip",
);

// The recent row now leads with 🚀 for A, and 👍 for B (separate browsers).
await clickAction(A, 0, "Add reaction");
await A.waitForSelector(".emoji-picker", { timeout: 2000 });
check(
  (await pickerEmoji(A, "emoji-recent"))[0] === "🚀",
  "A's recent row starts with 🚀",
);
await A.keyboard.press("Escape");
check(
  await waitFor(async () => (await A.$(".emoji-picker")) === null),
  "Esc closes the picker",
);
await sleep(200);
await clickAction(B, 0, "Add reaction");
await B.waitForSelector(".emoji-picker", { timeout: 2000 });
const recentB = await pickerEmoji(B, "emoji-recent");
check(recentB.length === 1 && recentB[0] === "👍", "B's recent row is just 👍");
// Picking from recents toggles B's 👍 off; the chip goes away for both.
await B.click(".emoji-picker .emoji-recent .emoji-option");
check(
  await waitFor(async () => {
    chips = await chipsOf(A, 0);
    return chips.length === 1 && chips[0].emoji === "🚀";
  }),
  "removing the last 👍 drops the chip for A",
);

// Reactions survive a reload (list round-trip).
await reloadShared(A, { waitUntil: "networkidle0" });
check(
  await waitFor(async () => {
    chips = await chipsOf(A, 0);
    return chips.length === 1 && chips[0].emoji === "🚀" && chips[0].mine;
  }),
  "reload shows the same chips, highlighted for A",
);

await done();

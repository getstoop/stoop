import type { Page } from "@playwright/test";
import { expect, reload, say, seed, signIn, test } from "./lib";

// Reactions: the picker (recents, the common row, the whole Unicode set,
// search by name), chips that count and name their reactors, toggling
// from the chip and from recents, and a round trip through a reload.
// Ported from web/e2e/reactions.mjs (STOOP-238).
test("reacting to a message", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const message = (p: Page) => p.locator(".message").first();
  const chips = (p: Page) => message(p).locator(".reaction-chip");
  const chip = (p: Page, emoji: string) => chips(p).filter({ hasText: emoji });
  const count = (p: Page, emoji: string) =>
    chip(p, emoji).locator(".reaction-count");
  const picker = (p: Page) => p.locator(".emoji-picker");
  const openPicker = async (p: Page) => {
    await message(p).hover();
    await message(p)
      .locator('.message-action[aria-label="Add reaction"]')
      .click();
    await expect(picker(p)).toBeVisible();
  };

  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await say(A, "shipped reactions");

  // The action is there for everyone, first in the row.
  await expect(
    B.locator(".message-action").first(),
    "Add reaction is the first message action",
  ).toHaveAttribute("title", "Add reaction");

  // B opens the picker: no recents yet, the common row is there, picks 👍.
  await openPicker(B);
  await expect(
    picker(B).locator(".emoji-recent"),
    "no recents at first",
  ).toHaveCount(0);
  const thumbsUp = picker(B).locator(
    '.emoji-common .emoji-option[title="thumbs up"]',
  );
  await expect(thumbsUp, "common row includes 👍").toHaveText("👍");
  const sections = picker(B).locator(".emoji-section");
  await expect(sections.first(), "Common heads the sections").toHaveText(
    "Common",
  );
  await expect(
    sections.filter({ hasText: "Flags" }),
    "the full set is grouped below Common",
  ).toHaveCount(1);
  expect(
    await picker(B).locator(".emoji-all .emoji-option").count(),
    "the full Unicode set is in the picker",
  ).toBeGreaterThan(1500);
  await thumbsUp.click();
  await expect(picker(B), "picker closes after picking").toHaveCount(0);
  await expect(chips(B), "B's 👍 is her message's only chip").toHaveCount(1);
  await expect(count(B, "👍"), "B sees count 1").toHaveText("1");
  await expect(chip(B, "👍"), "B's own chip is highlighted").toHaveClass(
    /mine/,
  );

  // A sees it live with B's name in the tooltip, not highlighted.
  await expect(chips(A), "A sees the chip live").toHaveCount(1);
  await expect(count(A, "👍"), "A sees count 1").toHaveText("1");
  await expect(
    chip(A, "👍"),
    "not highlighted for A, who hasn't reacted",
  ).not.toHaveClass(/mine/);
  await expect(chip(A, "👍"), "tooltip names B").toHaveAttribute(
    "title",
    new RegExp(`bea${suffix}`),
  );

  // A adds the same emoji by clicking the chip: 2, highlighted for A, both named.
  await chip(A, "👍").click();
  await expect(count(A, "👍"), "A's click makes it 2").toHaveText("2");
  await expect(chip(A, "👍"), "and highlighted for A").toHaveClass(/mine/);
  await expect(chip(A, "👍"), "tooltip still names B").toHaveAttribute(
    "title",
    new RegExp(`bea${suffix}`),
  );
  await expect(chip(A, "👍"), "tooltip names A too").toHaveAttribute(
    "title",
    new RegExp(`ada${suffix}`),
  );
  await expect(count(B, "👍"), "B sees 2").toHaveText("2");
  await expect(chip(B, "👍"), "still highlighted for her").toHaveClass(/mine/);

  // A clicks again: back to 1, no longer A's.
  await chip(A, "👍").click();
  await expect(count(A, "👍"), "A's second click removes hers").toHaveText("1");
  await expect(chip(A, "👍"), "and drops her highlight").not.toHaveClass(
    /mine/,
  );
  await expect(count(B, "👍"), "B sees 1").toHaveText("1");
  await expect(chip(B, "👍"), "still hers").toHaveClass(/mine/);

  // Picker search finds an emoji by name; Enter picks the first match.
  await openPicker(A);
  const search = picker(A).locator("input");
  const results = picker(A).locator(".emoji-results .emoji-option");
  await search.fill("rocket");
  await expect(results.first(), 'search "rocket" finds 🚀').toHaveText("🚀");
  await search.fill("flag canada");
  await expect(
    results.first(),
    'search "flag canada" finds 🇨🇦 from the generated names',
  ).toHaveText("🇨🇦");
  await search.fill("rocket");
  // Enter picks from the rendered results, so let them catch up first.
  await results.filter({ hasText: "🚀" }).first().waitFor();
  await search.press("Enter");
  await expect(chips(B), "B sees A's 🚀 arrive as a second chip").toHaveCount(
    2,
  );
  await expect(count(B, "🚀"), "the new chip counts 1").toHaveText("1");

  // The recent row now leads with 🚀 for A, and 👍 for B (separate browsers).
  await openPicker(A);
  await expect(
    picker(A).locator(".emoji-recent .emoji-option").first(),
    "A's recent row starts with 🚀",
  ).toHaveText("🚀");
  await A.keyboard.press("Escape");
  await expect(picker(A), "Esc closes the picker").toHaveCount(0);
  await openPicker(B);
  const recentB = picker(B).locator(".emoji-recent .emoji-option");
  await expect(recentB, "B's recent row is just 👍").toHaveText(["👍"]);
  // Picking from recents toggles B's 👍 off; the chip goes away for both.
  await recentB.click();
  await expect(
    chips(A),
    "removing the last 👍 drops the chip for A",
  ).toHaveCount(1);
  await expect(
    chips(A).locator(".reaction-emoji"),
    "leaving 🚀 behind",
  ).toHaveText("🚀");

  // Reactions survive a reload (list round-trip).
  await reload(A);
  await expect(chips(A), "reload shows the same chips").toHaveCount(1);
  await expect(
    chips(A).locator(".reaction-emoji"),
    "still 🚀 after the reload",
  ).toHaveText("🚀");
  await expect(chips(A), "highlighted for A").toHaveClass(/mine/);
});

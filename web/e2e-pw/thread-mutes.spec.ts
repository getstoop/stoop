import type { Locator, Page } from "@playwright/test";
import { expect, focus, gotoShared, seed, signIn, test } from "./lib";

// The channel and the panel each have a timeline and a composer.
const channelRows = (p: Page) => p.locator(".channel-view .message");
const panel = (p: Page) => p.locator(".side-panel");
const panelRows = (p: Page) => panel(p).locator(".message");
const sayIn = async (p: Page, where: string, text: string) => {
  await p.locator(`${where} .composer textarea`).fill(text);
  await p.keyboard.press("Enter");
};
const act = async (row: Locator, label: string) => {
  await row.hover();
  await row.locator(`.message-action[aria-label="${label}"]`).click();
};

// Phase 2 of threads (STOOP-433 to 435): the new-reply count on the
// summary, one Activity entry per thread, reading by opening it, and a
// mute that silences both until it is undone from the panel or Profile.
test("thread mutes and new replies", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await A.locator(".channel-view .composer textarea").waitFor();
  await B.locator(".channel-view .composer textarea").waitFor();

  await sayIn(A, ".channel-view", "who can lend a hedge trimmer?");
  const root = channelRows(B).filter({ hasText: "hedge trimmer" });
  await expect(root, "B has the message").toHaveCount(1);
  await act(root, "Reply in thread");
  await sayIn(B, ".side-panel", "I have one, electric");
  await expect(panelRows(B).filter({ hasText: "electric" })).toHaveCount(1);
  await sayIn(B, ".side-panel", "the battery is charged");
  await expect(panelRows(B).filter({ hasText: "battery" })).toHaveCount(1);

  // A started it, so both replies are new to her, live.
  const summary = A.locator(".channel-view .thread-summary");
  await expect(summary, "the summary counts both replies").toContainText(
    "2 replies",
  );
  await expect(
    summary.locator(".thread-new"),
    "and says both are new to A",
  ).toHaveText(/2 new/i);

  // Activity holds one entry for the thread, not one per reply, and
  // opening it opens the thread and reads it.
  await A.locator(".space-pill.activity").click();
  const entries = A.locator(".activity-row", {
    hasText: "replied in a thread",
  });
  await expect(entries, "one Activity entry for two replies").toHaveCount(1);
  await entries.click();
  await expect(panel(A), "the entry opens the thread").toBeVisible();
  // Reading needs the window's attention, which only one page has.
  await focus(A);
  await expect(
    summary.locator(".thread-new"),
    "seeing the replies clears the count",
  ).toHaveCount(0);

  // A mute shows on the summary and stops both the count and the entry.
  await panel(A).getByRole("button", { name: "Mute thread" }).click();
  await expect(
    panel(A).getByRole("button", { name: "Unmute thread" }),
  ).toBeVisible();
  await expect(summary, "the summary shows the mute").toHaveAttribute(
    "aria-label",
    /muted/,
  );
  await panel(A).locator(".side-panel-close").click();
  await expect(panel(A)).toHaveCount(0);
  await sayIn(B, ".side-panel", "I can drop it by at noon");
  await expect(summary, "the reply reaches A's summary").toContainText(
    "3 replies",
  );
  await expect(
    summary.locator(".thread-new"),
    "but adds no count while muted",
  ).toHaveCount(0);

  // Profile → Muted lists the thread by its first message, and unmutes it.
  await gotoShared(A, "/profile?tab=muted");
  const mutedRow = A.locator(".mutes-section tr", {
    hasText: "hedge trimmer",
  });
  await expect(mutedRow, "Profile lists the muted thread").toHaveCount(1);
  await mutedRow.getByRole("button", { name: "Unmute the thread" }).click();
  await expect(mutedRow, "Unmute takes it off the list").toHaveCount(0);
});

// Also send to channel (STOOP-436): one reply in both timelines, a line in
// the channel naming its thread that opens the thread on it, and a tag in
// the thread.
test("also send to channel", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await A.locator(".channel-view .composer textarea").waitFor();
  await B.locator(".channel-view .composer textarea").waitFor();

  await sayIn(A, ".channel-view", "compost bins: anyone want one?");
  await expect(channelRows(B)).toHaveCount(1);
  await act(channelRows(B).first(), "Reply in thread");
  const box = panel(B).getByRole("checkbox", {
    name: "Also send to #general",
  });
  await box.check();
  await sayIn(B, ".side-panel", "yes please, two");
  await expect(box, "the choice clears after sending").not.toBeChecked();
  await expect(
    panelRows(B).filter({ hasText: "yes please" }).locator(".also-sent-marker"),
    "the thread tags the reply",
  ).toHaveText("Also sent to #general");
  await sayIn(B, ".side-panel", "only in the thread");
  await expect(panelRows(B).filter({ hasText: "only in" })).toHaveCount(1);

  const sent = channelRows(A).filter({ hasText: "yes please" });
  await expect(sent, "the reply shows in the channel").toHaveCount(1);
  await expect(
    sent.locator(".thread-origin"),
    "with a line naming its thread",
  ).toContainText("compost bins");
  await expect(
    A.locator(".channel-view .thread-summary"),
    "A's summary has both replies",
  ).toContainText("2 replies");
  await expect(
    channelRows(A),
    "the plain reply stays in the thread",
  ).toHaveCount(2);

  await sent.locator(".thread-origin").click();
  await expect(
    panel(A).locator(".message.flash .message-content"),
    "the line opens the thread on that reply",
  ).toContainText("yes please");
});

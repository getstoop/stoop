import type { Page } from "@playwright/test";
import { acceptDialog, expect, say, seed, signIn, test } from "./lib";

// Which message actions each role is offered, the inline editor (Enter
// saves with an (edited) marker, Esc cancels), and deleting — live for
// everyone, with the reply quote left behind.
// Ported from web/e2e/edits.mjs (STOOP-238).
test("message actions, editing and deleting", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const message = (p: Page, index: number) => p.locator(".message").nth(index);
  const content = (p: Page, index: number) =>
    message(p, index).locator(".message-content");
  // The titles of the actions on a row, in the order they are offered.
  const actions = (p: Page, index: number) =>
    message(p, index)
      .locator(".message-action")
      .evaluateAll((els: HTMLElement[]) => els.map((e) => e.title));
  const clickAction = async (p: Page, index: number, label: string) => {
    await message(p, index).hover();
    await message(p, index)
      .locator(`.message-action[aria-label="${label}"]`)
      .click();
  };

  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);

  await say(B, "helo wrld");
  // B's message has to land before A's, or the indices below swap.
  await B.locator(".message-content", { hasText: "helo wrld" }).waitFor();
  await say(A, "owner here");

  // Actions visible (Add reaction, Copy link and Reply for everyone): B
  // (member) sees Edit/Delete on her own, not on A's; A (owner) sees
  // Delete on B's.
  await expect
    .poll(() => actions(B, 0), {
      message: "member: own message has Reply/Edit/Delete",
    })
    .toEqual(["Add reaction", "Copy link", "Reply", "Edit", "Delete"]);
  await expect
    .poll(() => actions(B, 1), {
      message: "member: someone else's has only Reply",
    })
    .toEqual(["Add reaction", "Copy link", "Reply"]);
  await expect
    .poll(() => actions(A, 0), {
      message: "owner: another's message has Reply/Delete (no Edit)",
    })
    .toEqual(["Add reaction", "Copy link", "Reply", "Delete"]);

  // B edits: inline editor, Enter saves, (edited) marker, A sees it live.
  await clickAction(B, 0, "Edit");
  await B.locator(".message-editor textarea").fill("hello world");
  await B.keyboard.press("Enter");
  await expect(content(B, 0), "edit saved").toHaveText(/^hello world/);
  await expect(
    message(B, 0).locator(".edited-marker"),
    "edit carries the (edited) marker",
  ).toBeVisible();
  await expect(content(A, 0), "A sees the edit live").toHaveText(
    /^hello world/,
  );
  await expect(
    message(A, 0).locator(".edited-marker"),
    "A sees the (edited) marker too",
  ).toBeVisible();

  // Esc cancels without saving.
  await clickAction(B, 0, "Edit");
  await B.locator(".message-editor textarea").pressSequentially(" zzz");
  await B.keyboard.press("Escape");
  // innerText is empty while the editor covers it, so this also proves
  // Esc put the message back.
  await expect(content(B, 0), "Esc cancels an edit").toHaveText(
    /^hello world/,
    { useInnerText: true },
  );
  await expect(content(B, 0), "the cancelled text is gone").not.toContainText(
    "zzz",
  );

  // A replies to B's message, then B deletes hers: A's reply shows
  // "(message deleted)"; the list shrinks live for both.
  await clickAction(A, 0, "Reply");
  await say(A, "hi bea");
  await A.locator(".reply-quote").waitFor();
  await clickAction(B, 0, "Delete");
  await acceptDialog(B);
  await expect(
    B.locator(".message-content", { hasText: "hello world" }),
    "deleted message disappears for B",
  ).toHaveCount(0);
  await expect(
    A.locator(".message-content", { hasText: "hello world" }),
    "deleted message disappears for A",
  ).toHaveCount(0);
  await expect(
    A.locator(".reply-quote"),
    "reply quote shows '(message deleted)'",
  ).toContainText("(message deleted)");

  // B has none left, so the owner deletes their own reply.
  const before = await A.locator(".message-content").count();
  await clickAction(A, before - 1, "Delete");
  await acceptDialog(A);
  await expect(
    A.locator(".message-content"),
    "owner's delete lands for A",
  ).toHaveCount(before - 1);
  await expect(
    B.locator(".message-content"),
    "owner's delete propagates to B",
  ).toHaveCount(before - 1);
});

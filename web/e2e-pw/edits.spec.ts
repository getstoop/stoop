import type { Page } from "@playwright/test";
import { BASE } from "../e2e/seed.mjs";
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

  // Actions visible (Add reaction, Copy link, Reply in thread and Reply
  // for everyone): B
  // (member) sees Edit/Delete on her own, not on A's; A (owner) sees
  // Delete on B's, and Pin on any of them (manage_channels).
  await expect
    .poll(() => actions(B, 0), {
      message: "member: own message has Reply/Edit/Delete",
    })
    .toEqual([
      "Add reaction",
      "Copy link",
      "Reply in thread",
      "Reply",
      "Edit",
      "Delete",
    ]);
  await expect
    .poll(() => actions(B, 1), {
      message: "member: someone else's has only Reply",
    })
    .toEqual(["Add reaction", "Copy link", "Reply in thread", "Reply"]);
  await expect
    .poll(() => actions(A, 0), {
      message: "owner: another's message has Pin/Reply/Delete (no Edit)",
    })
    .toEqual([
      "Add reaction",
      "Copy link",
      "Pin",
      "Reply in thread",
      "Reply",
      "Delete",
    ]);

  // B edits: inline editor, Enter saves, (edited) marker, A sees it live.
  await clickAction(B, 0, "Edit");
  await B.locator(".message-editor .rich-editor-content").fill("hello world");
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
  await B.locator(".message-editor .rich-editor-content").pressSequentially(
    " zzz",
  );
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

// The inline editor's draft survives the view scrolling away from its row:
// the virtualised list keeps the edited row mounted beyond the overscan
// (docs/architecture/web.md → The message list).
test("an unsaved edit survives scrolling away and back", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { tokens, channels } = await seed({ channels: ["general"] });
  // One page, seeded over RPC from Node (window.spec.ts says why): at this
  // height the rows near the bottom plus the overscan come to thirty or
  // so, so the first rows are out of the DOM once the view is there.
  const SEED = 50;
  const ids: string[] = [];
  for (let i = 1; i <= SEED; i++) {
    const res = await fetch(`${BASE}/stoop.chat.v1.ChatService/SendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.ada}`,
      },
      body: JSON.stringify({
        channelId: channels.general,
        content: `message ${i}`,
      }),
    });
    if (!res.ok) throw new Error(`seeding message ${i}: HTTP ${res.status}`);
    ids.push((await res.json()).message.id);
  }

  const A = await (
    await browser.newContext({ viewport: { width: 1100, height: 600 } })
  ).newPage();
  const list = A.locator(".message-list");
  const editor = A.locator(".message-editor .rich-editor-content");
  const rowOf = (id: string) => A.locator(`#msg-${id}`);
  const scrollTo = (top: number) =>
    list.evaluate((element, top) => {
      element.scrollTop = top;
    }, top);
  const scrollTop = () => list.evaluate((element) => element.scrollTop);

  await signIn(A, tokens.ada);
  await expect(list, "the window holds every message").toHaveAttribute(
    "data-rows",
    String(SEED),
  );
  await expect
    .poll(scrollTop, { message: "starts scrolled to the bottom" })
    .toBeGreaterThan(0);

  // Edit the window's first message, rendered once the view is at the top.
  await scrollTo(0);
  const edited = rowOf(ids[0]);
  await expect(edited).toBeAttached();
  await edited.hover();
  await edited.locator('.message-action[aria-label="Edit"]').click();
  await expect(editor, "the editor opens on the message").toHaveText(
    "message 1",
  );
  await editor.pressSequentially(" with a draft");
  await expect(editor).toHaveText("message 1 with a draft");
  const editingAt = await scrollTop();

  // At the bottom the rows near the edited one have left the DOM; the
  // edited row has not.
  await scrollTo(1_000_000);
  await expect(
    rowOf(ids[4]),
    "a row near the top is out of the DOM at the bottom",
  ).toHaveCount(0);
  await expect(
    rowOf(ids[0]),
    "the row being edited stays mounted",
  ).toBeAttached();

  // Back where the edit began, the draft is as it was typed.
  await scrollTo(editingAt);
  await expect(editor, "the draft survives the round trip").toHaveText(
    "message 1 with a draft",
  );
  await expect(editor).toBeVisible();
  await A.keyboard.press("Escape");
  await expect(editor, "Esc closes the editor").toHaveCount(0);
});

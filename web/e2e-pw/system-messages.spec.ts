import { BASE } from "../e2e/seed.mjs";
import {
  acceptDialog,
  channelLink,
  expect,
  focus,
  pastGate,
  rowByText,
  seed,
  sendMessage,
  signIn,
  test,
} from "./lib";

// System messages (STOOP-536): renaming a channel records a line in its
// timeline that marks nothing unread for anyone, reaches the people in
// the channel live, and only a moderator may delete.
test("a rename's system message", async ({ browser }) => {
  const { tokens, channels } = await seed({ channels: ["general", "random"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  // B waits in #random, away from the channel about to be renamed, where
  // a row that counted would make it bold and light the space's dot.
  await channelLink(B, "random").click();
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();

  // Ada, the space's owner, renames #general from its row's menu.
  await A.locator(".channel-row", { hasText: "general" })
    .locator(".dots-menu-button")
    .click();
  await A.getByRole("menuitem", { name: "Edit name", exact: true }).click();
  await acceptDialog(A, "porch");
  await expect(channelLink(B, "porch"), "B hears of the rename").toBeVisible();

  // A message in #random after the rename: once B has it, B has handled
  // the rename's row too, since one socket delivers both in order. B
  // reads it where it lands, so it leaves nothing unread of its own.
  await focus(B);
  await sendMessage(tokens.ada, channels.random, "after the rename");
  await expect(rowByText(B, "after the rename")).toBeVisible();
  await expect(
    channelLink(B, "porch"),
    "the rename marks the channel unread for no one",
  ).not.toHaveClass(/unread/);
  await expect(
    B.locator(".space-rail-list .pill-dot"),
    "…and lights no space dot",
  ).toHaveCount(0);

  const line = (page: typeof A) =>
    page.locator(".system-row", {
      hasText: "renamed the channel from #general to #porch",
    });
  await channelLink(B, "porch").click();
  await expect(line(B), "the row is in the channel").toBeVisible();
  await expect(
    line(B).locator(".system-glyph svg"),
    "…with its glyph where an avatar would be",
  ).toBeVisible();
  await expect(line(B).locator(".avatar"), "…and no avatar").toHaveCount(0);

  // A member sees no action on the row; the owner sees Delete alone.
  await line(B).hover();
  await expect(
    line(B).locator(".message-action"),
    "a member has nothing to do on a system message",
  ).toHaveCount(0);
  await channelLink(A, "porch").click();
  await line(A).hover();
  await expect(
    line(A).locator(".message-action"),
    "the owner has one action",
  ).toHaveCount(1);
  await line(A).getByRole("button", { name: "Delete" }).click();
  await expect(A.locator(".modal[data-dialog]")).toContainText(
    "Delete this line from the channel?",
  );
  await acceptDialog(A);
  await expect(line(A), "the owner's delete removes it").toHaveCount(0);
  await expect(line(B), "…for everyone").toHaveCount(0);
  await expect(
    channelLink(B, "porch"),
    "the rename itself stays",
  ).toBeVisible();
});

// A call to the chat service as someone, from Node: the quick way to fill
// a channel, and to pin and delete far from what a page shows.
async function chat(token: string, method: string, body: object) {
  const res = await fetch(`${BASE}/stoop.chat.v1.ChatService/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  return res.json();
}

// Pinning a message records a row that goes to it (STOOP-539): View lands
// on a message the list holds and on one more than a page above it, the
// row marks nothing unread, and deleting the message takes the excerpt
// and View away, live.
test("a pin's system message", async ({ browser }) => {
  const { tokens, channels, space } = await seed({
    channels: ["general", "random"],
  });
  const channelId = channels.general;
  // An old message with more than a page after it, so a list opened on
  // the newest page does not hold it. Sent in order, one at a time.
  const old = await chat(tokens.ada, "SendMessage", {
    channelId,
    content: "house rules: mute when you eat",
  });
  for (let index = 1; index <= 60; index++) {
    await chat(tokens.ada, "SendMessage", {
      channelId,
      content: `filler ${index}`,
    });
  }
  await chat(tokens.ada, "SendMessage", { channelId, content: "last call" });
  // Both have read it all, so the channel opens at its newest message
  // rather than on the "New messages" line.
  for (const token of [tokens.ada, tokens.bea]) {
    await chat(token, "MarkChannelRead", { channelId });
  }

  const channelPath = `/s/${space.id}/c/${channelId}`;
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  // A channel link stops on the desktop-app gate first.
  await signIn(A, tokens.ada, channelPath);
  await pastGate(A);
  await signIn(B, tokens.bea, channelPath);
  await pastGate(B);
  await expect(rowByText(A, "last call")).toBeVisible();
  await expect(rowByText(B, "last call")).toBeVisible();
  // Bea reads #general with the page at the front, so it is read.
  await focus(B);

  const pinRow = (page: typeof A, excerpt: string) =>
    page.locator(".system-row", { hasText: `pinned a message: ${excerpt}` });

  // Ada, the owner, pins the newest message from its actions; Bea sees
  // the row arrive, and View lands on the message.
  await rowByText(A, "last call").hover();
  await rowByText(A, "last call")
    .locator('.message-action[aria-label="Pin"]')
    .click();
  await expect(
    pinRow(B, "last call"),
    "the row reaches Bea live",
  ).toBeVisible();
  await pinRow(B, "last call")
    .getByRole("button", { name: "View pinned message" })
    .click();
  await expect(
    B.locator(".message.flash", { hasText: "last call" }),
    "View lands on the pinned message",
  ).toBeVisible();

  // Bea goes to #random, and the old message is pinned from elsewhere:
  // its row is the newest in #general, the message more than a page
  // above it. A message in #random after the pin is the sign Bea has
  // handled the row too, since one socket delivers both in order; she
  // reads it where it lands, so it leaves nothing unread of its own.
  await channelLink(B, "random").click();
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();
  await expect(
    channelLink(B, "general"),
    "Bea has read #general before the pin",
  ).not.toHaveClass(/unread/);
  await chat(tokens.ada, "SetMessagePinned", {
    messageId: old.message.id,
    pinned: true,
  });
  await sendMessage(tokens.ada, channels.random, "after the pin");
  await expect(rowByText(B, "after the pin")).toBeVisible();
  await expect(
    channelLink(B, "general"),
    "the pin marks the channel unread for no one",
  ).not.toHaveClass(/unread/);
  await expect(
    B.locator(".space-rail-list .pill-dot"),
    "…and lights no space dot",
  ).toHaveCount(0);

  await channelLink(B, "general").click();
  await expect(
    pinRow(B, "house rules"),
    "the second row is in the channel",
  ).toBeVisible();
  await expect(
    B.locator(".message-list"),
    "Bea's list holds the newest page, not the old message",
  ).not.toHaveAttribute("data-oldest", old.message.id);
  await pinRow(B, "house rules")
    .getByRole("button", { name: "View pinned message" })
    .click();
  await expect(
    B.locator(".message.flash", { hasText: "house rules" }),
    "View goes to a message the list did not hold",
  ).toBeVisible();

  // Deleting the pinned message leaves the row, which says so and goes
  // nowhere, on Ada's page without a reload.
  const rowId = await pinRow(A, "house rules").getAttribute("id");
  await chat(tokens.ada, "DeleteMessage", { messageId: old.message.id });
  const row = A.locator(`[id="${rowId}"]`);
  await expect(row, "the row stays").toContainText(
    "pinned a message (since deleted)",
  );
  await expect(
    row.getByRole("button", { name: "View pinned message" }),
    "…with nothing to view",
  ).toHaveCount(0);
});

import { BASE } from "../e2e/seed.mjs";
import {
  acceptDialog,
  channelLink,
  expect,
  focus,
  gotoShared,
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
// row marks nothing unread, and deleting the message takes the row away,
// live.
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

  // Bea goes back to the newest page, where both rows are.
  await channelLink(B, "random").click();
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();
  await channelLink(B, "general").click();
  await expect(pinRow(B, "house rules")).toBeVisible();
  await expect(pinRow(B, "last call")).toBeVisible();

  // Deleting a pinned message takes its row with it, without a reload:
  // from elsewhere, for both pages...
  await expect(pinRow(A, "house rules")).toBeVisible();
  await chat(tokens.ada, "DeleteMessage", { messageId: old.message.id });
  await expect(
    pinRow(A, "house rules"),
    "deleted from elsewhere, the row goes",
  ).toHaveCount(0);
  await expect(pinRow(B, "house rules"), "…for everyone").toHaveCount(0);

  // ...and from Ada's own page, at once for her and live for Bea.
  await expect(pinRow(B, "last call")).toBeVisible();
  await expect(pinRow(A, "last call")).toBeVisible();
  await rowByText(A, "last call").hover();
  await rowByText(A, "last call")
    .locator('.message-action[aria-label="Delete"]')
    .click();
  await acceptDialog(A);
  await expect(rowByText(A, "last call")).toHaveCount(0);
  await expect(
    pinRow(A, "last call"),
    "the deleter's own row goes",
  ).toHaveCount(0);
  await expect(pinRow(B, "last call"), "…and Bea's").toHaveCount(0);
  await expect(
    A.locator(".system-row", { hasText: "pinned a message" }),
    "no pin row is left saying anything",
  ).toHaveCount(0);
});

// Membership (STOOP-538): adding people to a private channel records one
// row naming them, which reaches the people in it and nobody outside,
// and a long list unfolds in place and folds again.
test("a private channel's membership rows", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal", "dan", "eve", "fay", "gus", "hal"],
    channels: ["general"],
  });
  const name = (user: string) => `${user}${suffix}`;
  const open = async (token: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, token);
    await page.locator(".composer .rich-editor-content").waitFor();
    return page;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const H = await open(tokens.hal);
  const addPeople = async (...users: string[]) => {
    await A.getByRole("button", { name: "Add people" }).click();
    for (const user of users)
      await A.locator(".candidate-row", { hasText: name(user) })
        .locator("input")
        .check();
    await A.locator(".modal .modal-actions .primary").click();
  };

  // Ada, the space's owner, makes a private channel and adds two people.
  await A.locator(".channel-group-heading .channel-add:not(.voice)").click();
  await A.getByLabel("Channel name").fill("captains");
  await A.getByRole("switch").check();
  await A.getByRole("button", { name: "Create" }).click();
  await expect(A.locator(".channel-header .channel-title")).toHaveText(
    "captains",
  );
  await expect(
    A.locator(".system-row"),
    "making the channel records nothing",
  ).toHaveCount(0);
  const address = A.url();
  await addPeople("bea", "cal");

  const twoAdded = `${name("ada")} added ${name("bea")} and ${name("cal")}`;
  await channelLink(B, "captains").click();
  await expect(
    B.locator(".system-row", { hasText: twoAdded }),
    "someone added sees the row naming who was added",
  ).toBeVisible();
  await expect(
    A.locator(".system-row", { hasText: twoAdded }),
    "…and so does the person who added them",
  ).toBeVisible();

  // Four more: two named and a count, which unfolds and folds again.
  await addPeople("dan", "eve", "fay", "gus");
  const long = B.locator(".system-row", {
    hasText: `${name("ada")} added ${name("dan")}, ${name("eve")} and 2 others`,
  });
  await expect(long).toBeVisible();
  const others = long.getByRole("button", { name: "2 others" });
  await expect(others).toHaveAttribute("aria-expanded", "false");
  await others.click();
  const all = `${name("ada")} added ${name("dan")}, ${name("eve")}, ${name("fay")} and ${name("gus")}`;
  const unfolded = B.locator(".system-row", { hasText: all });
  await expect(unfolded, "the list unfolds in place").toBeVisible();
  const fewer = unfolded.getByRole("button", { name: "Show fewer" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await expect(fewer, "focus moves to the control that folds it").toBeFocused();
  await fewer.click();
  await expect(long, "…and folds again").toBeVisible();
  await expect(unfolded).toHaveCount(0);

  // Hal, outside the channel, has neither the channel nor its rows: not
  // in his sidebar, nothing at its address, and its history refused.
  // (Who receives which row live is internal/app's e2e test.)
  await expect(channelLink(H, "captains")).toHaveCount(0);
  await gotoShared(H, address);
  await expect(channelLink(H, "general")).toBeVisible();
  await expect(H.getByText(twoAdded)).toHaveCount(0);
  const history = await H.request.post(
    `${new URL(H.url()).origin}/stoop.chat.v1.ChatService/ListMessages`,
    {
      headers: { authorization: `Bearer ${tokens.hal}` },
      data: { channelId: new URL(address).pathname.split("/").pop() },
    },
  );
  expect(history.status(), "its history is refused").toBe(404);
});

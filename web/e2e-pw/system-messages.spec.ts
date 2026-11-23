import {
  acceptDialog,
  channelLink,
  expect,
  focus,
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

  // Hal, outside the channel, has neither the channel nor its rows.
  await expect(channelLink(H, "captains")).toHaveCount(0);
  await expect(H.locator(".system-row")).toHaveCount(0);
});

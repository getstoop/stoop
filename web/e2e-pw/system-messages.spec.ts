import { acceptDialog, channelLink, expect, seed, signIn, test } from "./lib";

// System messages (STOOP-536): renaming a channel records a line in its
// timeline that reaches everyone in it live, marks nothing unread, and
// only a moderator may delete.
test("a rename's system message", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general", "random"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await channelLink(B, "general").click();
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();

  // Ada, the space's owner, renames #general from its row's menu. B's page
  // is not the one at the front, so a row that counted would go unread
  // there rather than being read on arrival.
  await A.locator(".channel-row", { hasText: "general" })
    .locator(".dots-menu-button")
    .click();
  await A.getByRole("menuitem", { name: "Edit name", exact: true }).click();
  await acceptDialog(A, "porch");

  const line = (page: typeof A) =>
    page.locator(".system-row", {
      hasText: "renamed the channel from #general to #porch",
    });
  await expect(line(B), "B sees the rename arrive live").toBeVisible();
  await expect(
    line(B).locator(".system-glyph svg"),
    "…with its glyph where an avatar would be",
  ).toBeVisible();
  await expect(line(B).locator(".avatar"), "…and no avatar").toHaveCount(0);
  // The row and the unread state come in the same event, so once the row
  // shows, the channel would already be bold.
  await expect(
    channelLink(B, "porch"),
    "the rename marks nothing unread",
  ).not.toHaveClass(/unread/);
  await expect(
    B.locator(".space-rail-list .pill-dot"),
    "…and lights no space dot",
  ).toHaveCount(0);

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

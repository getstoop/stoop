import type { Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  menuItems,
  seed,
  signIn,
  spaceMenu,
  test,
} from "./lib";

const atPath = (p: Page, want: string, message: string) =>
  expect.poll(() => new URL(p.url()).pathname, { message }).toBe(want);

// The space header's actions (About, Invite, Space settings, Leave) live
// behind its ⋮.

// Space settings: renaming, the invite toggle, the channels tab
// (reorder, rename, delete, and the last channel that can't go),
// promotion, transferring ownership and deleting the space — each of
// them reaching the other member live.
// Ported from web/e2e/settings.mjs (STOOP-238).
test("space settings, roles and deletion", async ({ browser }) => {
  const { suffix, tokens } = await seed();
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const channelNames = (p: Page) =>
    p.locator(".channel-link:not(.add) .channel-name");
  const channelRow = (name: string) =>
    A.locator(".user-row", { hasText: `# ${name}` });

  // A owns "Stoop HQ" (+ #random), B is a member.
  await signIn(A, tokens.ada);
  await expect(A.locator(".composer textarea")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

  await expect
    .poll(() => menuItems(B), {
      message: "a member is not offered Space settings",
    })
    .not.toContain("Space settings");
  await spaceMenu(A, "Space settings");
  await expect(A, "owner opens settings").toHaveURL(/\/settings$/);

  // Rename the space: sidebar and B's pill update live.
  const spaceName = A.locator('input[aria-label="Space name"]');
  await spaceName.fill("The Porch");
  await spaceName.press("Enter");
  await expect(A.locator(".profile-header h2"), "space renamed").toHaveText(
    "The Porch",
  );
  await expect(B.locator(".space-name"), "B sees the new name live").toHaveText(
    "The Porch",
  );

  // Members can invite toggle → B gains the Invite chip live.
  await A.locator(".toggle-row input").click();
  await expect
    .poll(() => menuItems(B), { message: "invite toggle reaches B live" })
    .toContain("Invite people");

  // Channels: reorder, rename, delete.
  await A.locator('.settings-tab[data-tab="channels"]').click();
  await channelRow("random").getByTitle("Move up").click();
  await expect(channelNames(B), "B sees reordered channels").toHaveText([
    "random",
    "general",
  ]);
  await channelRow("general").getByRole("button", { name: "Rename" }).click();
  const channelName = A.locator('input[aria-label="Channel name"]');
  await channelName.fill("lounge");
  await channelName.press("Enter");
  await expect(
    channelLink(B, "lounge"),
    "B sees the renamed channel live",
  ).toBeVisible();

  // B is in #random when it goes.
  await channelLink(B, "random").click();
  await channelRow("random").getByRole("button", { name: "Delete" }).click();
  await acceptDialog(A);
  await expect(
    channelLink(B, "random"),
    "the deleted channel leaves B's sidebar",
  ).toHaveCount(0);
  await expect(B, "B is bounced into another channel").toHaveURL(/\/c\//);
  const lastDelete = channelRow("lounge").getByRole("button", {
    name: "Delete",
  });
  await expect(
    lastDelete,
    "the last channel still offers Delete",
  ).toBeVisible();
  await expect(lastDelete, "last channel can't be deleted").toBeDisabled();

  // Members tab: promote B from settings; B's gear appears.
  await A.locator('.settings-tab[data-tab="members"]').click();
  await expect(
    A.locator(".legend"),
    "members tab explains kick/ban/block",
  ).toContainText("Kick");
  await A.locator('.settings-tab[data-tab="banned"]').click();
  await expect(
    A.locator(".bans-section"),
    "banned tab shows the empty ban list",
  ).toContainText("Nobody is banned");
  await A.locator('.settings-tab[data-tab="members"]').click();
  await A.locator(".user-row", { hasText: `bea${suffix}` })
    .getByRole("button", { name: "Make admin" })
    .click();
  await expect
    .poll(() => menuItems(B), {
      message: "a promoted member is offered Space settings live",
    })
    .toContain("Space settings");

  // Transfer ownership to B; A becomes admin and loses the Owner section.
  await A.locator('.settings-tab[data-tab="owner"]').click();
  const newOwner = A.locator('select[aria-label="New owner"]');
  await newOwner.selectOption({ index: 1 });
  await A.getByRole("button", { name: "Transfer ownership" }).click();
  await acceptDialog(A);
  await expect(newOwner, "after transfer, A can't transfer again").toHaveCount(
    0,
  );
  await expect(
    A.locator('.settings-tab[data-tab="owner"]'),
    "A keeps only the instance admin's delete",
  ).toHaveText("Server admin");
  await spaceMenu(B, "Space settings");
  await B.locator('.settings-tab[data-tab="owner"]').click();
  await expect(
    B.locator('select[aria-label="New owner"]'),
    "B (new owner) sees the owner section",
  ).toBeVisible();

  // B deletes the space: both land on home.
  await B.getByRole("button", { name: "Delete this space" }).click();
  await acceptDialog(B, "The Porch");
  await atPath(B, "/", "space deleted; B bounced home");
  await atPath(A, "/", "space deleted; A bounced home too");
});

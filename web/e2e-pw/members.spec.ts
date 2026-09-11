import type { Page } from "@playwright/test";
import { acceptDialog, expect, say, seed, signIn, test } from "./lib";

// Who is in a space and who may act on them: the members panel, the
// profile card (profile-only, with a link to settings for management),
// roles in Space settings → Members, and kicking and leaving.
// Ported from web/e2e/members.mjs (STOOP-238).
test("the member list, roles, kicking and leaving", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });

  // The space header's actions (About, Invite, Space settings, Leave)
  // live behind its ⋮.
  const dots = (p: Page) => p.locator(".sidebar-header .dots-menu-button");
  const menuItems = async (p: Page) => {
    await dots(p).click();
    const items = p.locator(".dots-menu button");
    await expect(items.first()).toBeVisible();
    const labels = (await items.allTextContents()).map((s) => s.trim());
    await p.keyboard.press("Escape");
    await expect(p.locator(".dots-menu")).toHaveCount(0);
    return labels;
  };
  const pickMenu = async (p: Page, label: string) => {
    await dots(p).click();
    await p.locator(".dots-menu button", { hasText: label }).click();
  };
  const openMembersTab = async (p: Page) => {
    await pickMenu(p, "Space settings");
    await p.locator('.settings-tab[data-tab="members"]').click();
    await expect(p.locator(".user-row").first()).toBeVisible();
  };
  const rowChip = (p: Page, name: string, label: string) =>
    p
      .locator(".user-row")
      .filter({ hasText: name })
      .locator(".chip", { hasText: label });

  // A owns the seeded space; B and C are members. Each says something, so
  // the timeline has an author to click.
  const speak = async (token: string, text: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await expect(p.locator(".composer textarea")).toBeVisible();
    await say(p, text);
    await expect(
      p.locator(".message-content", { hasText: text }),
    ).toBeVisible();
    return p;
  };
  const A = await speak(tokens.ada, "welcome all");
  const B = await speak(tokens.bea, `hi from bea${suffix}`);
  const C = await speak(tokens.cal, `hi from cal${suffix}`);

  expect(await menuItems(B), "B (member) is not offered Invite").not.toContain(
    "Invite people",
  );
  await expect(
    B.locator(".members-heading"),
    "members panel lists 3",
  ).toContainText("Members · 3");
  await expect(
    B.locator(".members-panel"),
    "…with the owner badged",
  ).toContainText("owner");
  await B.locator(".member-row").first().click();
  await expect(
    B.locator(".user-card"),
    "clicking a member opens the profile card",
  ).toBeVisible();
  await B.keyboard.press("Escape");
  await expect(B.locator(".user-card")).toHaveCount(0);
  expect(await menuItems(B), "B is offered Leave").toContain("Leave space");
  expect(await menuItems(A), "the owner is not offered Leave").not.toContain(
    "Leave space",
  );

  // The card is profile-only now: Message and Block, never roles or
  // removal — those live in the space's settings, with a link to them.
  await A.locator(".message-author")
    .filter({ hasText: `bea${suffix}` })
    .click();
  await expect(
    A.locator(".user-card-actions button"),
    "card offers only Message and Block",
  ).toHaveText(["Message", "Block"]);
  await expect(
    A.locator(".user-card .card-manage-link"),
    "the owner's card links to space settings for management",
  ).toBeVisible();
  await A.keyboard.press("Escape");
  await expect(A.locator(".user-card")).toHaveCount(0);

  // Roles live in Space settings → Members. A promotes B there.
  await openMembersTab(A);
  await rowChip(A, `bea${suffix}`, "Make admin").click();
  await expect
    .poll(() => menuItems(B), {
      message: "B is offered Invite live after promotion",
    })
    .toContain("Invite people");

  // B (now admin) in settings: the owner is untouchable, a member is not.
  await openMembersTab(B);
  await expect(B.locator(".user-row"), "all three are listed").toHaveCount(3);
  await expect(
    B.locator(".user-row")
      .filter({ hasText: `ada${suffix}` })
      .locator(".chip"),
    "admin B gets no actions on the owner's row",
  ).toHaveCount(0);
  await expect(
    rowChip(B, `cal${suffix}`, "Kick"),
    "admin B can act on member C's row",
  ).toBeVisible();

  // B kicks C from settings; C is bounced home.
  await rowChip(B, `cal${suffix}`, "Kick").click();
  await acceptDialog(B);
  await expect(C, "kicked C bounced to /").toHaveURL("/");
  await expect(C.locator("#root"), "C sees the no-spaces home").toContainText(
    "Welcome to Stoop",
  );
  await B.locator(".profile-header .chip").click();

  // B leaves via the sidebar; bounced home.
  await pickMenu(B, "Leave space");
  await acceptDialog(B);
  await expect(B, "B left and landed on /").toHaveURL("/");
  await A.locator(".profile-header .chip").click();
  await expect(
    A.locator(".members-heading"),
    "owner's members panel shrinks live",
  ).toContainText("Members · 1");

  // A's view: only A remains.
  const list = await A.evaluate(async () => {
    const r = await fetch("/stoop.chat.v1.ChatService/ListSpaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { spaces } = await r.json();
    const m = await fetch("/stoop.chat.v1.ChatService/ListMembers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: spaces[0].id }),
    });
    return (await m.json()).members.map(
      (x: { username: string; role: string }) => `${x.username}:${x.role}`,
    );
  });
  expect(list, `members now: ${list}`).toHaveLength(1);
  expect(list[0], "…and that one is the owner").toMatch(/SPACE_ROLE_OWNER$/);
});

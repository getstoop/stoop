import type { Page } from "@playwright/test";
import { acceptDialog, expect, pastGate, seed, signIn, test } from "./lib";

// A channel says what it is: the topic in its header, the tooltips that
// carry it, About this channel, and who may write it (STOOP-114).
// Ported from web/e2e/channel-topic.mjs (STOOP-238).

// Long enough to overflow a 1280px header, which is the case the
// truncation exists for, and near the 250-character cap.
const TOPIC =
  "Borrow anything on the shelf — sign it out here, say what you took, and have it back within a week so the next person is not left waiting. Ladders live in the yard, not the hallway. The chainsaw needs Marguerite.";
const SECOND = "Shelf is full. Please take something.";

test("a channel's topic", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const open = async (token: string) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const p = await context.newPage();
    await signIn(p, token);
    await p.locator(".composer textarea").waitFor();
    return p;
  };

  const topic = (p: Page) => p.locator(".channel-header .channel-topic");
  const menu = (p: Page) => p.locator(".dots-menu");
  const openMenu = async (p: Page) => {
    await p.locator(".channel-row .dots-menu-button").click();
    await menu(p).waitFor();
  };
  const menuItem = (p: Page, label: string) =>
    menu(p).getByRole("menuitem", { name: label, exact: true });

  // ---- A lands in the space's first channel
  const A = await open(tokens.ada);

  // ---- The empty state is an invitation, and only for someone who can act
  await expect(
    A.locator(".channel-topic.empty"),
    "a manager with no topic set is invited to add one",
  ).toHaveText("Add a topic");
  await expect(
    A.locator(".channel-topic-rule"),
    "the divider comes with it",
  ).toBeVisible();

  // ---- Setting it from the header
  await A.locator(".channel-topic.empty").click();
  await acceptDialog(A, TOPIC);
  await expect(topic(A), "the header carries the topic once saved").toHaveText(
    TOPIC,
  );

  // A spec cannot see an ellipsis, so measure it: the box holds one line
  // of text and the content is wider than the box.
  const line = await topic(A).evaluate((el) => {
    const s = getComputedStyle(el);
    const pad =
      Number.parseFloat(s.paddingTop) + Number.parseFloat(s.paddingBottom);
    return {
      overflows: el.scrollWidth > el.clientWidth,
      content: el.clientHeight - pad,
      lineHeight: Number.parseFloat(s.lineHeight) || el.clientHeight,
      nowrap: s.whiteSpace === "nowrap",
      ellipsis: s.textOverflow === "ellipsis",
      weight: s.fontWeight,
    };
  });
  expect(line.nowrap, "the topic never wraps").toBe(true);
  expect(line.ellipsis, "…it truncates with an ellipsis").toBe(true);
  expect(line.overflows, "…and this topic is wider than its box").toBe(true);
  expect(line.content, "…so it is one line tall").toBeLessThanOrEqual(
    line.lineHeight + 1,
  );
  expect(line.weight, "the topic is lighter than the name it follows").toBe(
    "400",
  );

  // ---- Hover reads it in full; click opens About
  await topic(A).hover();
  await expect(
    A.locator(".tooltip"),
    "hovering the header spells the whole topic out",
  ).toContainText("The chainsaw needs Marguerite.");
  await A.mouse.move(640, 600);

  await topic(A).click();
  const about = A.locator(".channel-about");
  await expect(
    about,
    "About this channel shows the topic in full",
  ).toContainText(TOPIC);
  await expect(about, "…and what kind of channel it is").toContainText(
    "Text channel",
  );
  await A.keyboard.press("Escape");
  await expect(about, "Escape closes About").toHaveCount(0);

  // ---- The sidebar row now says what the room is before you click it
  await A.locator(".channel-row .channel-link").hover();
  const tip = A.locator(".tooltip");
  await expect(tip, "the sidebar tooltip carries the name").toContainText(
    "general",
  );
  await expect(tip, "…and the topic under it").toContainText(
    "Borrow anything on the shelf",
  );
  await A.mouse.move(640, 600);

  // ---- Space settings lists it, and writes it
  const spaceId = new URL(A.url()).pathname.split("/")[2];
  await A.goto(`/s/${spaceId}/settings?tab=channels`);
  await expect(
    A.locator(".user-row"),
    "the settings row shows the topic under the channel name",
  ).toContainText("Borrow anything on the shelf");
  await A.goBack();
  await pastGate(A);

  // ---- B: a member sees the topic, may not write it
  const B = await open(tokens.bea);
  await expect(topic(B), "a member reads the topic in the header").toHaveText(
    TOPIC,
  );
  await openMenu(B);
  await expect(menu(B), "a member may open About").toContainText(
    "About this channel",
  );
  await expect(
    menu(B).getByRole("menuitem").filter({ hasText: "topic" }),
    "…and is offered nothing that writes the topic",
  ).toHaveCount(0);
  await B.keyboard.press("Escape");

  // ---- Realtime: the edit lands in B's header with no reload
  await openMenu(A);
  await expect(
    menuItem(A, "Edit topic"),
    "a manager edits it from the ⋮",
  ).toBeVisible();
  await menuItem(A, "Edit topic").click();
  await acceptDialog(A, SECOND);
  await expect(
    topic(B),
    "the change reaches everyone else without a reload",
  ).toHaveText(SECOND);

  // ---- Clearing it puts the invitation back for a manager, and nothing
  // at all in front of a member
  await openMenu(A);
  await menuItem(A, "Edit topic").click();
  await acceptDialog(A, "");
  await expect(
    A.locator(".channel-topic.empty"),
    "clearing the topic restores the manager's invitation",
  ).toHaveText("Add a topic");
  await expect(
    topic(B),
    "a member is left with the channel name alone",
  ).toHaveCount(0);

  // ---- On a phone the header keeps only the name; the ⋮ still has About
  await A.goto("/");
  await openMenu(A);
  await menuItem(A, "Add a topic").click();
  await acceptDialog(A, TOPIC);
  await topic(A).waitFor();
  await A.setViewportSize({ width: 390, height: 844 });
  await expect(
    topic(A),
    "the topic strip is out of a phone's header",
  ).toBeHidden();
});

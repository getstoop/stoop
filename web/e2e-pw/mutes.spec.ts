import type { Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  focus,
  menuItems,
  say,
  seed,
  signIn,
  test,
} from "./lib";

type Note = { title: string; body: string };
declare global {
  interface Window {
    __notes: Note[];
  }
}

// Mutes own the badges (STOOP-133): a muted channel or DM raises no dot
// and no mention badge anywhere, while the mention still reaches the
// activity feed and lights the activity pill's dot. STOOP-135 adds the
// space half: muting a space silences every channel under it. STOOP-136
// lists every mute on Profile → Notifications.
// Ported from web/e2e/mutes.mjs (STOOP-238).
test("mutes silence every badge but the feed", async ({ browser }) => {
  const { suffix, tokens } = await seed();
  const aName = `ada${suffix}`;
  const bName = `bea${suffix}`;

  // A and B are seeded into "Stoop HQ" with #general and #random.
  const contextA = await browser.newContext();
  const A = await contextA.newPage();
  await signIn(A, tokens.ada);
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.bea);
  await B.locator(".composer textarea").waitFor();

  // The first channel row is #general (or the one conversation in the DM
  // list); it is the muted one throughout.
  const row = (p: Page) => p.locator(".channel-row").first();
  // a.space-pill, not .space-pill: the rail's Create and Join buttons
  // carry the same class, and while the spaces query is still loading
  // they are the only matches — .first() then clicks Join and leaves its
  // modal over everything that follows.
  const railPill = (p: Page) => p.locator(".space-rail-list a.space-pill");
  const activityDot = (p: Page) => p.locator(".space-pill.activity .pill-dot");

  // Mute or unmute the first channel row on the page.
  const setMuted = async (p: Page, muted: boolean, why: string) => {
    const r = row(p);
    await r.hover();
    await r.locator(".dots-menu-button").click();
    const item = p.getByRole("menuitem", {
      name: muted ? "Mute" : "Unmute",
      exact: true,
    });
    await expect(item, why).toHaveCount(1);
    await item.click();
    // The row follows the server's answer, so waiting for it is the
    // barrier the original's sleep was.
    const link = r.locator(".channel-link");
    if (muted) await expect(link).toHaveClass(/muted/);
    else await expect(link).not.toHaveClass(/muted/);
  };

  // The activity page lists items without reading them; the header's
  // button is what clears the feed.
  const markAllRead = async (p: Page) => {
    const chip = p.locator(".activity-page-header .chip");
    // The feed arrives after the page does, so give the button its chance
    // before concluding there is nothing to clear.
    const offered = await chip
      .waitFor({ state: "attached", timeout: 5_000 })
      .then(
        () => true,
        () => false,
      );
    if (!offered) return;
    await chip.click();
    // It goes when the count reaches zero, which is after the RPC.
    await expect(chip).toHaveCount(0);
  };

  // The picker opens and filters per keystroke, so the composer is typed
  // into; a delay keeps the keystrokes from interleaving with a send that
  // went just before.
  const mention = async (p: Page, name: string, body: string) => {
    await p
      .locator(".composer textarea")
      .pressSequentially(`@${name} ${body}`, { delay: 20 });
    // Escape first, or Enter would pick from the picker instead of sending.
    await p.keyboard.press("Escape");
    await p.keyboard.press("Enter");
  };

  const pickSpaceMenu = async (p: Page, label: string, why: string) => {
    await p.locator(".sidebar-header .dots-menu-button").click();
    const item = p.getByRole("menuitem", { name: label, exact: true });
    await expect(item, why).toHaveCount(1);
    await item.click();
  };

  // ---- The channel row menu, and the mute it offers.
  await row(A).hover();
  await row(A).locator(".dots-menu-button").click();
  await expect(
    A.locator(".dots-menu button"),
    "owner's channel menu: Mute, Copy link, Edit name, Add a topic, Delete",
  ).toHaveText([
    "Mute",
    "Copy link",
    "Edit name",
    "Add a topic",
    "Delete channel",
  ]);
  await A.keyboard.press("Escape");
  await setMuted(A, true, "mute #general from the row menu");
  await expect(
    row(A).locator(".channel-link.muted"),
    "the muted row is dimmed",
  ).toHaveCount(1);

  // A parks in #random so nothing in #general is read on arrival.
  await channelLink(A, "random").click();

  // An ordinary message in a muted channel: no bold, no unread dot.
  await say(B, "ping while muted");
  await B.locator(".message-content", {
    hasText: "ping while muted",
  }).waitFor();
  // Nothing is supposed to reach A, so this waits rather than polls.
  await A.waitForTimeout(1200);
  await expect(
    row(A).locator(".channel-link.unread"),
    "a new message in a muted channel doesn't bold the row",
  ).toHaveCount(0);
  await expect(
    railPill(A).locator(".pill-dot"),
    "and raises no unread dot on the space pill",
  ).toHaveCount(0);

  // A mention in a muted channel: activity yes, every other badge no.
  await mention(B, aName, "are you around?");
  await expect(
    activityDot(A),
    "a mention in a muted channel lights the activity pill's dot",
  ).toBeAttached();
  await expect(
    row(A).locator(".channel-badge"),
    "and raises no mention badge on the channel row",
  ).toHaveCount(0);
  await expect(
    railPill(A).locator(".pill-badge"),
    "and none on the space pill",
  ).toHaveCount(0);
  await A.locator(".space-pill.activity").click();
  await expect(
    A.locator(".activity-row").first(),
    "the mention is on the activity page all the same",
  ).toContainText("are you around?");
  await expect(
    A.locator(".activity-page-header"),
    "and counts on the page header, which mutes never touch",
  ).toContainText("1 unread");
  // The page lists without reading; clearing it is the header's button —
  // and read state only counts on the page holding the attention.
  await focus(A);
  await markAllRead(A);
  await expect(
    activityDot(A),
    "marking all read clears the pill's dot",
  ).toHaveCount(0);

  // ---- Unmuting brings the badges back.
  await A.goto("/");
  await channelLink(A, "random").click();
  await setMuted(A, false, "unmute from the row menu");
  await mention(B, aName, "and a mention");
  await expect(
    row(A).locator(".channel-badge"),
    "after unmuting, the channel row badges the mention",
  ).toHaveCount(1);
  await expect(
    railPill(A).locator(".pill-badge"),
    "and so does the space pill",
  ).toHaveCount(1);

  // B (a member) gets Mute only, nothing to manage.
  await row(B).hover();
  await row(B).locator(".dots-menu-button").click();
  await expect(
    B.locator(".dots-menu button"),
    "member's channel menu: Mute and Copy link",
  ).toHaveText(["Mute", "Copy link"]);
  await B.keyboard.press("Escape");

  // ---- A muted DM: the DMs pill stays clean, activity still hears.
  await A.locator(".member-row", { hasText: bName }).click();
  await A.locator(".user-card .message-button").click();
  // A DM opened straight off the user card mounts its composer before
  // React has the conversation wired up; fill()+Enter there sets the
  // value but sends nothing. Typing it generates the events the composer
  // actually listens to.
  const dmComposer = A.locator(".composer textarea");
  await dmComposer.click();
  await dmComposer.pressSequentially("starting a thread", { delay: 20 });
  await A.keyboard.press("Enter");
  await A.locator(".message-content", {
    hasText: "starting a thread",
  }).waitFor();
  await setMuted(A, true, "mute the conversation from the DM row menu");

  // Clear everything so the pills below can only be about the muted DM.
  await A.goto("/activity");
  await focus(A);
  await markAllRead(A);
  await expect(activityDot(A), "the activity pill starts clean").toHaveCount(0);
  await A.goto("/profile");
  await B.locator(".space-pill.dms").click();
  await B.locator(".composer textarea").waitFor();
  await say(B, "you there?");
  await B.locator(".message-content", { hasText: "you there?" }).waitFor();
  // The DMs pill is meant to stay clean, so this waits rather than polls.
  await A.waitForTimeout(1500);
  await expect(
    A.locator(".space-pill.dms .pill-badge, .space-pill.dms .pill-dot"),
    "a message in a muted DM raises nothing on the DMs pill",
  ).toHaveCount(0);
  await expect(
    activityDot(A),
    "but the activity pill is dotted for it",
  ).toBeAttached();

  // ---- A fresh tab that never opens the space (STOOP-138). Its channel
  // list is cold, so the mute can only come from the server's stamp on
  // the item.
  await A.goto("/");
  await railPill(A).first().click();
  await setMuted(A, true, "mute #general again for the cold-cache case");
  await A.goto("/activity");
  await markAllRead(A);

  // Headless Chrome can't show native notifications; record what the app
  // tries to show instead.
  await contextA.grantPermissions(["notifications"]);
  const A2 = await contextA.newPage();
  await A2.addInitScript(() => {
    window.__notes = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission() {
        return Promise.resolve("granted");
      }
      constructor(title: string, opts?: { body?: string }) {
        window.__notes.push({ title, body: opts?.body ?? "" });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification });
  });
  await A2.goto("/profile");
  const notes = () => A2.evaluate(() => window.__notes.length);

  await B.goto("/");
  await railPill(B).first().click();
  await channelLink(B, "general").click();
  await mention(B, aName, "cold cache, muted");
  // Again a badge that should never appear: nothing to poll on.
  await A2.waitForTimeout(1500);
  await expect(
    railPill(A2).locator(".pill-badge"),
    "a mention in a muted channel raises no space badge on a tab that never opened the space",
  ).toHaveCount(0);
  await expect(
    activityDot(A2),
    "and the activity pill is dotted for it all the same",
  ).toBeAttached();
  expect(await notes(), "and no desktop banner fires for it").toBe(0);

  // The control: the same tab, an unmuted channel, banner and badge both.
  await channelLink(B, "random").click();
  await mention(B, aName, "cold cache, unmuted");
  await expect
    .poll(notes, { message: "an unmuted channel does fire the banner" })
    .toBe(1);
  await expect(
    railPill(A2).locator(".pill-badge"),
    "and badges the space pill",
  ).toHaveCount(1);

  // ---- Muting a whole space (STOOP-135) ----

  // A2 was opened in front of A and everything below drives A again, so
  // give it the foreground; A2 is only read from, and a banner fires
  // whether or not its tab is visible.
  await focus(A);

  // Start from a clean slate: #general unmuted, so everything below is
  // the space's doing.
  await A.goto("/");
  await railPill(A).first().click();
  await setMuted(A, false, "unmute #general so only the space mutes");

  expect(
    await menuItems(A),
    "owner's space menu: About, Copy link, Invite, Settings, Mute space",
  ).toEqual([
    "About this space",
    "Copy link",
    "Invite people",
    "Space settings",
    "Mute space",
  ]);
  await pickSpaceMenu(A, "Mute space", "mute the space from its menu");
  // Polled, not read once: menuItems() materialises the labels into an
  // array, so a plain expect on it cannot retry, and the label only flips
  // once the mute RPC lands. Reopening the menu per attempt is what the
  // helper already does.
  await expect
    .poll(() => menuItems(A), {
      message: "and the item flips to Unmute space",
    })
    .toContain("Unmute space");

  // The space's own surfaces.
  const bell = A.locator(".sidebar-header .space-muted-icon");
  await expect(bell, "a muted bell appears beside the space name").toHaveCount(
    1,
  );
  await expect(bell, "and it says Muted").toHaveAttribute(
    "aria-label",
    "Muted",
  );
  await expect(
    A.locator(".space-rail-list .space-pill.muted"),
    "the space pill is dimmed",
  ).toHaveCount(1);
  await expect(
    A.locator(".channel-list .channel-link:not(.muted)"),
    "and every channel row under it is dimmed",
  ).toHaveCount(0);

  // A channel cannot be louder than its space.
  await row(A).hover();
  await row(A).locator(".dots-menu-button").click();
  const firstItem = A.locator(".dots-menu button").first();
  await expect(
    firstItem,
    "the channel menu's first item reads Muted by space",
  ).toHaveText("Muted by space");
  await expect(firstItem, "and it is disabled").toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await A.keyboard.press("Escape");

  // The other tab in the same context followed the mute over the wire.
  await expect(
    A2.locator(".space-rail-list .space-pill.muted"),
    "a second tab follows the space mute without a reload",
  ).toHaveCount(1);

  // Nothing in a muted space interrupts. A sits on its profile so nothing
  // is read on arrival.
  await A.goto("/profile");
  await A.locator(".space-pill.activity").click();
  await markAllRead(A);
  await A.goto("/profile");
  const notesBefore = await notes();

  await channelLink(B, "general").click();
  await say(B, "quiet in here");
  await B.locator(".message-content", { hasText: "quiet in here" }).waitFor();
  // A dot that should never appear: nothing to poll on.
  await A.waitForTimeout(1500);
  await expect(
    railPill(A).locator(".pill-dot"),
    "a plain message in a muted space raises no unread dot",
  ).toHaveCount(0);

  await mention(B, aName, "muted space mention");
  await A.waitForTimeout(1500);
  await expect(
    railPill(A).locator(".pill-badge"),
    "a mention there raises no badge on the space pill",
  ).toHaveCount(0);
  await expect(
    activityDot(A),
    "but it does light the activity pill's dot",
  ).toBeAttached();
  expect(await notes(), "and fires no desktop banner").toBe(notesBefore);

  // ---- Unmuting gives everything back.
  await A.goto("/");
  await railPill(A).first().click();
  await pickSpaceMenu(A, "Unmute space", "unmute the space from its menu");
  await expect(bell, "the muted bell goes").toHaveCount(0);
  await expect(
    A.locator(".space-rail-list .space-pill.muted"),
    "and the pill is no longer dimmed",
  ).toHaveCount(0);
  await row(A).hover();
  await row(A).locator(".dots-menu-button").click();
  await expect(
    A.locator(".dots-menu button").first(),
    "the channel menu offers Mute again",
  ).toHaveText("Mute");
  await A.keyboard.press("Escape");

  // Park somewhere else so the mention below stays unread.
  await channelLink(A, "random").click();
  await channelLink(B, "general").click();
  await mention(B, aName, "and the badges are back");
  await expect(
    row(A).locator(".channel-badge"),
    "after unmuting the space, the channel row badges the mention again",
  ).toHaveCount(1);
  await expect(
    railPill(A).locator(".pill-badge"),
    "and so does the space pill",
  ).toHaveCount(1);

  // ---- Profile → Notifications lists every mute (STOOP-136) ----

  // A second space, so there is a channel mute that isn't under the muted
  // space; A lands in it, and its #general is the one muted.
  await A.locator('button[title="Create a space"]').click();
  await acceptDialog(A, "Book club");
  await expect(A.locator(".sidebar-header .space-name")).toHaveText(
    "Book club",
  );
  await setMuted(A, true, "mute #general in the second space");

  // Back to Stoop HQ: mute #general there too, then the whole space. The
  // channel mute is then covered by the space and shouldn't be listed.
  await railPill(A).first().click();
  await expect(A.locator(".sidebar-header .space-name")).toHaveText("Stoop HQ");
  await setMuted(A, true, "mute #general in the first space");
  await pickSpaceMenu(A, "Mute space", "then mute the space itself");

  // A row's label and its note ("direct message"), which sit in two
  // columns of the list.
  const muteRows = A.locator(".mute-list .mute-row");
  const muteLabels = () =>
    muteRows.evaluateAll((rows) =>
      rows.map((r) =>
        [r.querySelector(".mute-label"), r.querySelector(".user-cell")]
          .map((e) => (e as HTMLElement | null)?.innerText.trim() ?? "")
          .join(" ")
          .trim(),
      ),
    );
  const unmuteRow = async (label: string, why: string) => {
    const target = muteRows
      .filter({ has: A.locator(".mute-label", { hasText: label }) })
      .first();
    await expect(target, why).toHaveCount(1);
    const button = target.locator("button").first();
    // Unmuting a space reveals a channel row with a similar label, so the
    // barrier is this button going, not the row's. Two spaces both have a
    // #general, and their buttons are named alike, so count them down
    // rather than waiting for the name to vanish.
    const name = await button.getAttribute("aria-label");
    const alike = A.locator(`button[aria-label="${name}"]`);
    const before = await alike.count();
    await button.click();
    await expect(alike).toHaveCount(before - 1);
  };

  await A.goto("/profile?tab=notifications");
  await expect(muteRows, "three things are muted").toHaveCount(3);
  const listed = await muteLabels();
  expect(
    listed,
    "the tab lists the space, the other space's channel and the DM",
  ).toEqual([
    "Stoop HQ",
    "Book club › # general",
    expect.stringContaining(bName),
  ]);
  expect(listed[2], "…and marks the DM as one").toContain("direct message");
  expect(
    listed.some((l) => l.startsWith("Stoop HQ ›")),
    "and not the channel inside the muted space, which its row covers",
  ).toBe(false);

  // Unmuting the space clears it and reveals the channel mute underneath.
  await unmuteRow("Stoop HQ", "Unmute the space from the list");
  await expect(
    A.locator(".space-rail-list .space-pill.muted"),
    "the space pill is no longer dimmed",
  ).toHaveCount(0);
  await expect
    .poll(async () => (await muteLabels())[0], {
      message: "and the channel mute under it is listed now",
    })
    .toBe("Stoop HQ › # general");
  expect(await muteLabels(), "…still three rows").toHaveLength(3);

  // Empty once nothing is muted.
  await unmuteRow("Stoop HQ ›", "Unmute the channel");
  await unmuteRow("Book club", "Unmute the other space's channel");
  await unmuteRow(bName, "Unmute the conversation");
  await expect(
    A.locator(".mute-list"),
    "with nothing muted the card says so",
  ).toHaveCount(0);
  await expect(A.locator(".mutes-section"), "…in so many words").toContainText(
    "You haven't muted anything.",
  );
});

import type { Page } from "@playwright/test";
import {
  channelLink,
  expect,
  focus,
  gotoShared,
  reload,
  seed,
  sendMessage,
  signIn,
  test,
} from "./lib";

type Note = { title: string; body: string };
declare global {
  interface Window {
    __notes: Note[];
  }
}

// @mentions: the picker, the desktop banner, the badges on the activity
// pill, the space pill and the channel, the activity timeline, @channel —
// which the owner has and a member doesn't — and a badge that counts
// past the feed's first page.
// Ported from web/e2e/mentions.mjs (STOOP-238).
test("mentions notify, badge and read", async ({ browser }) => {
  const { suffix, tokens, ids, space, channels } = await seed();

  const composer = (p: Page) => p.locator(".composer .rich-editor-content");
  const activityDot = (p: Page) => p.locator(".space-pill.activity .pill-dot");
  const picker = (p: Page) => p.locator(".mention-picker");
  // The picker opens and filters per keystroke, so the composer is typed
  // into, never filled.
  const type = (p: Page, text: string) => composer(p).pressSequentially(text);
  const send = async (p: Page, text: string) => {
    await type(p, text);
    // Escape first, or Enter would pick from the picker instead of sending.
    await p.keyboard.press("Escape");
    await p.keyboard.press("Enter");
  };

  // A and B are seeded into "Stoop HQ" with #general and #random.
  // Headless Chrome can't show native notifications; stub the API and
  // record what the app tries to show.
  const contextA = await browser.newContext({ permissions: ["notifications"] });
  await contextA.addInitScript(() => {
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
  const A = await contextA.newPage();
  await signIn(A, tokens.ada);
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.bea);
  await expect(composer(B)).toBeVisible();

  // A parks in #random; B mentions A in #general.
  await channelLink(A, "random").click();
  await expect(
    A.locator(".pill-badge"),
    "A starts with no unread badge",
  ).toHaveCount(0);

  await type(B, "morning @ad");
  await expect(picker(B), "picker suggests the matching member").toContainText(
    `@ada${suffix}`,
  );
  await B.keyboard.press("Enter");
  await expect(composer(B), "Enter completes the mention").toHaveText(
    `morning @ada${suffix} `,
  );
  await expect(picker(B), "picker closes after completion").toHaveCount(0);
  // Set rather than typed: the completion above re-renders the composer,
  // and keystrokes racing that re-render arrive out of order — this line
  // showed up once as "morning @ada… offee?c", which then failed far away
  // at the banner. Only the "@ad" above needs the picker's per-keystroke
  // filtering; the rest of the line does not.
  await composer(B).fill(`morning @ada${suffix} coffee?`);
  await expect(composer(B), "the whole line is in the composer").toHaveText(
    `morning @ada${suffix} coffee?`,
  );
  await B.keyboard.press("Enter");

  const notes = () => A.evaluate(() => window.__notes);
  await expect
    .poll(notes, { message: "one desktop banner requested" })
    .toHaveLength(1);
  const [banner] = await notes();
  expect(banner.title, "the banner names who mentioned you").toBe(
    `bea${suffix} mentioned you`,
  );
  expect(
    banner.body,
    `the banner carries what they said (${banner.body})`,
  ).toContain("coffee?");

  // Badges on the activity pill, space pill and the #general channel — A
  // is elsewhere, so nothing is auto-read.
  await expect(activityDot(A), "A's activity pill is dotted").toBeVisible();
  await expect(
    A.locator(".space-rail-list .pill-badge"),
    "A's space pill shows 1 unread",
  ).toHaveText("1");
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "#general shows a channel badge",
  ).toHaveText("1");
  await expect(
    B.locator(".mention.me"),
    "B's own mention isn't marked as theirs",
  ).toHaveCount(0);

  // Viewing #general via the sidebar (not the activity pill) reads the
  // item — which only counts while the page has the user's attention.
  await focus(A);
  await channelLink(A, "general").click();
  await expect(
    A.locator(".mention.me"),
    "mention token highlighted as 'me' for A",
  ).toHaveText(`@ada${suffix}`);
  await expect(
    activityDot(A),
    "viewing the channel clears the activity badge",
  ).toHaveCount(0);
  await expect(
    A.locator(".channel-badge"),
    "and the channel badge",
  ).toHaveCount(0);

  // A mention arriving while A is already looking at #general is read
  // immediately — again, only while A has the attention.
  await focus(A);
  await send(B, `@ada${suffix} still there?`);
  await A.locator(".message-content", { hasText: "still there?" }).waitFor();
  await expect(
    activityDot(A),
    "a mention arriving in the open channel is read immediately",
  ).toHaveCount(0);

  // Desktop banners are a setting, so the test button is on the profile's
  // Notifications tab, not on the feed.
  await A.goto("/profile?tab=notifications");
  await A.getByRole("button", { name: "Send a test notification" }).click();
  await expect
    .poll(() => A.evaluate(() => window.__notes.at(-1)?.title), {
      message: "test button fires a desktop banner",
    })
    .toBe("Stoop notifications are working");

  // The activity pill opens the timeline; both mentions are listed and read.
  await A.locator(".space-pill.activity").click();
  await expect(A, "the activity pill opens /activity").toHaveURL(/\/activity$/);
  await expect(
    A.locator(".activity-row"),
    "timeline lists both mentions",
  ).toHaveCount(2);
  await expect(A.locator(".activity-row.unread"), "both are read").toHaveCount(
    0,
  );
  await expect(
    A.locator(".activity-page-header"),
    "header says caught up",
  ).toContainText("all caught up");

  // A third mention while on the timeline: an unread row appears, and
  // clicking it navigates and reads it.
  await send(B, `@ada${suffix} one more`);
  await expect(
    A.locator(".activity-row.unread"),
    "new mention shows unread on the timeline",
  ).toHaveCount(1);
  await expect(
    activityDot(A),
    "the pill is dotted while on the timeline",
  ).toBeVisible();
  await expect(
    A.locator(".activity-page-header"),
    "the page header keeps the count the pill dropped",
  ).toContainText("1 unread");
  await A.locator(".activity-row.unread").click();
  await expect(A, "clicking the row navigates to the channel").toHaveURL(
    /\/c\//,
  );
  await expect(activityDot(A), "and reads it").toHaveCount(0);

  // Self-mention and non-member mention create nothing.
  await send(A, `talking to @ada${suffix} and @nobody123`);
  await expect(
    A.locator(".mention"),
    "only real members render as mention tokens",
  ).toHaveCount(4);
  await expect(activityDot(A), "self-mention doesn't notify").toHaveCount(0);

  // @channel: the owner can (the picker offers it, B is notified); a
  // member can't (it stays plain text).
  await A.locator(".space-rail-list a.space-pill").click();
  await B.locator(".space-pill.avatar").click(); // B looks away
  await type(A, "@chan");
  await expect(picker(A), "owner's picker offers @channel").toContainText(
    "Everyone in this channel",
  );
  // The picker follows the caret: away from the query it closes, so
  // Enter can't replace the wrong words; back at it, it reopens. Home
  // takes the caret to the start of the document, and ProseMirror undoes
  // exactly that move when it comes within 200 ms of the editor gaining
  // focus, taking it for the browser's cursor-to-start on focus
  // (prosemirror-view, DOMObserver.flush). B's click above can take the
  // window from A, so type() re-focuses A's editor and the first Home can
  // be spent that way; the undo clears the focus mark, so a second press
  // always lands. Pressing Home at a line start is a no-op otherwise.
  await expect(async () => {
    await A.keyboard.press("Home");
    await expect(
      picker(A),
      "the caret leaving the query closes it",
    ).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await A.keyboard.press("End");
  await expect(picker(A), "…and coming back reopens it").toContainText(
    "Everyone in this channel",
  );
  await A.keyboard.press("Enter");
  await type(A, "game night");
  await A.keyboard.press("Enter");
  await expect(activityDot(B), "B is notified by @channel").toBeVisible();
  await B.locator(".space-rail-list a.space-pill").click();
  await expect(
    B.locator(".mention.me").filter({ hasText: "@channel" }),
    "B sees the @channel token highlighted",
  ).toHaveCount(1);

  await A.locator(".space-pill.avatar").click(); // A looks away
  await type(B, "@chan");
  // The keystrokes have landed, so the picker has had its chance.
  await expect(composer(B)).toHaveText("@chan");
  await expect(
    picker(B).filter({ hasText: "Everyone" }),
    "member's picker doesn't offer @channel",
  ).toHaveCount(0);
  await B.keyboard.press("Escape");
  await type(B, "nel please");
  await B.keyboard.press("Enter");
  await expect(
    B.locator(".mention").filter({ hasText: /^@channel$/ }),
    "member's @channel renders as plain text",
  ).toHaveCount(1);
  await expect(
    activityDot(A),
    "member's @channel doesn't notify the owner",
  ).toHaveCount(0);

  // Mark activity read from the timeline, after a mention arrives while
  // A is on /profile. It reads the feed and nothing else: the badges on
  // the channel and the space are the server's count of what is past
  // A's read marker there, and only reading #general clears them.
  await A.locator(".space-rail-list a.space-pill").click();
  await A.locator(".space-pill.avatar").click();
  await send(B, `@ada${suffix} last one`);
  await expect(
    activityDot(A),
    "mention while on /profile → the pill is dotted",
  ).toBeVisible();
  await A.locator(".space-pill.activity").click();
  await A.locator(".activity-mark-all").click();
  await expect(
    activityDot(A),
    "Mark activity read clears the activity dot",
  ).toHaveCount(0);
  await expect(
    A.locator(".activity-row.unread"),
    "no rows remain unread",
  ).toHaveCount(0);
  await expect(
    A.locator(".space-rail-list .pill-badge"),
    "but not the space badge, which counts the unread mention in #general",
  ).toHaveText("1");
  await focus(A);
  await A.locator(".space-rail-list a.space-pill").click();
  await channelLink(A, "general").click();
  await expect(
    A.locator(".space-rail-list .pill-badge"),
    "reading #general clears it",
  ).toHaveCount(0);

  // More mentions than the feed's first page holds. The badge is the
  // server's count of what is addressed to A past her marker, so sixty
  // show as sixty, not as the fifty items a page holds. Sent over RPC:
  // the subject is how many arrive, not the typing of them.
  await channelLink(A, "random").click();
  await expect(channelLink(A, "random")).toHaveClass(/active/);
  const mentionA = `<@u:${ids.ada}:ada${suffix}>`;
  for (let i = 1; i <= 60; i++) {
    await sendMessage(tokens.bea, channels.general, `${mentionA} ping ${i}`);
  }
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "#general badges all sixty",
  ).toHaveText("60");
  await expect(
    A.locator(".space-rail-list .pill-badge"),
    "and so does the space pill",
  ).toHaveText("60");
  await reload(A);
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "the server counts the same sixty",
  ).toHaveText("60");

  // A mention older than the feed's first page still badges, and the
  // inbox still shows it: one unread in #general, then fifty-five read
  // as they land in #random, where A is, push it past the page the feed
  // holds.
  await focus(A);
  await channelLink(A, "general").click();
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "reading #general clears the sixty",
  ).toHaveCount(0);
  await channelLink(A, "random").click();
  await expect(channelLink(A, "random")).toHaveClass(/active/);
  await sendMessage(tokens.bea, channels.general, `${mentionA} buried`);
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "the one in #general badges",
  ).toHaveText("1");
  for (let i = 1; i <= 55; i++) {
    await sendMessage(tokens.bea, channels.random, `${mentionA} seen ${i}`);
  }
  await A.locator(".message-content", { hasText: "seen 55" }).waitFor();
  await expect(
    channelLink(A, "random").locator(".channel-badge"),
    "the fifty-five read as they landed badge nothing",
  ).toHaveCount(0);
  // The server read them too, which the feed shows while nothing on
  // screen could read #random again: only the one in #general is unread.
  await A.locator(".space-pill.activity").click();
  await expect(
    A.locator(".activity-page-header"),
    "the server read the fifty-five that landed in the open channel",
  ).toContainText("1 unread");
  // Opened fresh, the inbox's first page is the fifty-five read items,
  // and the one unread sits past it; the page loads older pages on its
  // own until New holds everything the server counts, so the mention is
  // in New without a scroll.
  await reload(A);
  await A.locator(".space-pill.activity").click();
  await expect(
    A.locator(".activity-section.new .activity-row.unread"),
    "New shows the mention past the first page",
  ).toContainText("buried");
  await expect(
    A.locator(".activity-page-header"),
    "and the header counts it",
  ).toContainText("1 unread");
  expect(
    await A.locator(".activity-scroll").evaluate((list) => list.scrollTop),
    "without the list having scrolled",
  ).toBe(0);
  await gotoShared(A, `/s/${space.id}/c/${channels.random}`);
  await expect(
    channelLink(A, "general").locator(".channel-badge"),
    "the mention older than fifty-five newer read items still badges",
  ).toHaveText("1");
  await expect(
    channelLink(A, "random").locator(".channel-badge"),
    "and #random has none",
  ).toHaveCount(0);
});

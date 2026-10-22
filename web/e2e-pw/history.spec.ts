import { expect, reload, say, seed, signIn, test } from "./lib";

// Older history: the timeline opens on the latest page, loads the page
// before it when scrolled to the top without the view jumping, and shows
// "Beginning of #channel" once there is nothing older.
// Ported from web/e2e/history.mjs (STOOP-238). The viewport the
// puppeteer harness launched with is set on the contexts here.
// The list is virtualised: only the rows near the viewport are in the
// DOM, so what the window holds is read from the list's data-rows and
// data-oldest, never counted as .message elements (virtual-list.spec.ts
// is where the DOM's bound is checked).
const VIEWPORT = { width: 1100, height: 700 };

test("paging back through older history", async ({ browser }) => {
  const { tokens, channels } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext({ viewport: VIEWPORT })).newPage();

  const list = A.locator(".message-list");
  const pill = A.locator(".jump-latest");
  const scrollTop = () => list.evaluate((e) => e.scrollTop);
  const scrollToTop = () =>
    list.evaluate((e) => {
      e.scrollTop = 0;
    });
  const topOf = (id: string) =>
    A.evaluate(
      (id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1,
      id,
    );
  const oldest = A.locator(".message-content .md-lines").first();
  const atBottom = () =>
    list.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40);

  await signIn(A, tokens.ada);
  await expect(A.locator(".composer .rich-editor-content")).toBeVisible();

  // Seed 120 messages through the API, keeping their ids: the window's
  // oldest row is read back by id.
  const ids = await A.evaluate(async (channelId) => {
    const sent: string[] = [];
    for (let i = 1; i <= 120; i++) {
      const res = await fetch("/stoop.chat.v1.ChatService/SendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, content: `message ${i}` }),
      });
      sent.push((await res.json()).message.id);
    }
    return sent;
  }, channels.general);
  await reload(A);
  await expect(list, "opens on the latest page").toHaveAttribute(
    "data-rows",
    "50",
  );
  await expect(
    A.locator(".history-start"),
    "no beginning marker while there may be more",
  ).toHaveCount(0);
  await expect(list, "the oldest loaded message is #71").toHaveAttribute(
    "data-oldest",
    ids[70],
  );
  await expect
    .poll(scrollTop, { message: "starts scrolled to the bottom" })
    .toBeGreaterThan(0);

  // Scroll to the top: the previous page arrives and the message that was
  // at the top stays exactly where it was on screen.
  await scrollToTop();
  // The window's first row, rendered once the view is at the top (the
  // rows there are not in the DOM until then).
  const anchorId = `msg-${ids[70]}`;
  await expect(A.locator(`#${anchorId}`)).toBeAttached();
  const before = await topOf(anchorId);
  await expect(list, "second page loaded").toHaveAttribute("data-rows", "100");
  await expect
    .poll(async () => Math.abs((await topOf(anchorId)) - before), {
      message: "view stays anchored on the same message",
    })
    .toBeLessThan(3);
  await expect(list, "the oldest loaded message is now #21").toHaveAttribute(
    "data-oldest",
    ids[20],
  );

  // Again: the rest, and the beginning marker.
  await scrollToTop();
  await expect(list, "third page loaded").toHaveAttribute("data-rows", "120");
  // The view is still anchored on message 21; the marker is the row above
  // the first, rendered once the view is at the top.
  await scrollToTop();
  await expect(
    A.locator(".history-start"),
    "beginning marker names the channel",
  ).toContainText("Beginning of #general");
  await expect(
    oldest,
    "at the top, the first row on screen is the channel's first",
  ).toHaveText("message 1");
  // The one wait left: proving nothing more is fetched needs time to pass.
  await A.waitForTimeout(800);
  await expect(
    list,
    "nothing more is fetched past the beginning",
  ).toHaveAttribute("data-rows", "120");

  // Reading history: the pill offers a way back, and someone else's new
  // message doesn't yank the view — it counts on the pill instead.
  await scrollToTop();
  await expect(
    pill,
    "away from the bottom, a 'Jump to latest' pill appears",
  ).toHaveText("Jump to latest ↓");

  const B = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();
  const topBefore = await scrollTop();
  await say(B, "hello from bea");
  await expect(pill, "someone else's message counts on the pill").toHaveText(
    "1 new message ↓",
  );
  expect(
    Math.abs((await scrollTop()) - topBefore),
    "…and doesn't move the view",
  ).toBeLessThan(3);

  await pill.click();
  await expect(pill, "jumping to latest hides the pill").toHaveCount(0);
  await expect
    .poll(atBottom, { message: "…and lands at the bottom" })
    .toBe(true);

  // A new message still lands at the bottom and scrolls into view.
  await say(A, "message 121");
  await expect
    .poll(() => list.getAttribute("data-rows").then(Number), {
      message: "live messages still append",
    })
    .toBeGreaterThanOrEqual(121);
  await expect
    .poll(atBottom, { message: "a new message scrolls the view to the bottom" })
    .toBe(true);
});

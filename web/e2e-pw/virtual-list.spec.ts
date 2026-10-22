import { BASE } from "../e2e/seed.mjs";
import { anchoredTop, expect, say, seed, signIn, test } from "./lib";

// The virtualised timeline (routes/Channel/MessageList): the DOM holds only
// the rows near the viewport while the window holds many more; a quote's
// jump to a row the window holds but the DOM doesn't lands on it and
// flashes it; paging back keeps the viewed row where it was; Jump to latest
// returns to the bottom; an arrival follows at the bottom and counts on the
// pill when scrolled up. What the window holds is the list's data-rows.
const SEED = 160;
// The quoted message: in the newest page (the last 50) but far enough from
// its end that it is off screen, and out of the DOM, on opening (about
// eighteen rows show at this height, plus eight of overscan), and far
// enough from the page's start that landing on it asks for no older page.
const QUOTED = SEED - 32;
const VIEWPORT = { width: 1100, height: 700 };
// Rows on this screen plus the overscan either side come to about forty;
// the window holds a hundred and more by the time this is checked.
const DOM_BOUND = 60;

test("the list renders only the rows near the viewport", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { tokens, channels } = await seed({ channels: ["general"] });
  const channelId = channels.general;

  // Seed over RPC from Node (window.spec.ts says why), keeping the ids;
  // the last message quotes QUOTED.
  const ids: string[] = [];
  for (let i = 1; i <= SEED; i++) {
    const res = await fetch(`${BASE}/stoop.chat.v1.ChatService/SendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.ada}`,
      },
      body: JSON.stringify({
        channelId,
        content: `message ${i}`,
        replyToMessageId: i === SEED ? ids[QUOTED - 1] : "",
      }),
    });
    if (!res.ok) throw new Error(`seeding message ${i}: HTTP ${res.status}`);
    ids.push((await res.json()).message.id);
  }

  const A = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  const messages = A.locator(".message");
  const list = A.locator(".message-list");
  const pill = A.locator(".jump-latest");
  const rowOf = (id: string) => A.locator(`#msg-${id}`);
  const scrollTop = () => list.evaluate((e) => e.scrollTop);
  const scrollToTop = () =>
    list.evaluate((e) => {
      e.scrollTop = 0;
    });
  const atBottom = () =>
    list.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40);
  const onScreen = (id: string) =>
    A.evaluate((id) => {
      const el = document.getElementById(`msg-${id}`);
      const list = document.querySelector(".message-list");
      if (!el || !list) return false;
      const r = el.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      return r.top >= l.top && r.bottom <= l.bottom;
    }, id);
  const topOf = (id: string) =>
    A.evaluate(
      (id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1,
      id,
    );

  await signIn(A, tokens.ada);
  await expect(A.locator(".composer .rich-editor-content")).toBeVisible();
  await expect(list, "opens on the latest page").toHaveAttribute(
    "data-rows",
    "50",
  );
  await expect
    .poll(scrollTop, { message: "starts scrolled to the bottom" })
    .toBeGreaterThan(0);
  await expect(
    rowOf(ids[SEED - 1]),
    "the newest message is on screen",
  ).toBeVisible();
  expect(
    await messages.count(),
    "only the rows near the bottom are in the DOM",
  ).toBeLessThan(DOM_BOUND);
  await expect(
    rowOf(ids[QUOTED - 1]),
    "a row the window holds but the view is far from is not in the DOM",
  ).toHaveCount(0);

  // A quote's jump to a row in the window but not in the DOM: the list
  // scrolls there, renders it, and flashes it, without asking the server.
  await rowOf(ids[SEED - 1])
    .locator(".reply-quote")
    .click();
  await expect(
    rowOf(ids[QUOTED - 1]),
    "the quoted message is rendered and flashed",
  ).toHaveClass(/flash/);
  await expect
    .poll(() => onScreen(ids[QUOTED - 1]), {
      message: "…and is on screen",
    })
    .toBe(true);
  await expect(list, "…from the window as it was").toHaveAttribute(
    "data-rows",
    "50",
  );

  // An older page's request is held, when asked, until the position it
  // must not move has been read (anchoredTop in lib.ts says why that is
  // a poll); a gate set holds the next request.
  let gate: Promise<void> | null = null;
  let open = () => {};
  const holdPage = () => {
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
  };
  const releasePage = () => {
    gate = null;
    open();
  };
  await A.route("**/stoop.chat.v1.ChatService/ListMessages", async (route) => {
    if (gate) await gate;
    await route.continue();
  });

  // Scrolling to the top pages back, and the row at the top of the view
  // stays exactly where it was on screen.
  holdPage();
  const firstPageRequest = A.waitForRequest(/ChatService\/ListMessages/);
  await scrollToTop();
  // The window's first row, rendered once the view is at the top.
  const anchorId = `msg-${ids[SEED - 50]}`;
  await expect(A.locator(`#${anchorId}`)).toBeAttached();
  const before = await anchoredTop(A, anchorId);
  await firstPageRequest;
  releasePage();
  await expect(list, "the older page loaded").toHaveAttribute(
    "data-rows",
    "100",
  );
  await expect
    .poll(async () => Math.abs((await topOf(anchorId)) - before), {
      message: "the view stays anchored on the same row",
    })
    .toBeLessThan(3);
  expect(
    await messages.count(),
    "the DOM still holds only the rows near the view",
  ).toBeLessThan(DOM_BOUND);

  // Away from the bottom the pill offers the way back.
  await expect(pill, "the pill is offered").toHaveText("Jump to latest ↓");

  // A message posted while an older page is still out neither moves the
  // viewed row then, nor when the page lands: the page's request is held
  // here until the message has arrived.
  const B = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer .rich-editor-content")).toBeVisible();
  holdPage();
  const pageRequest = A.waitForRequest(/ChatService\/ListMessages/);
  await scrollToTop();
  const heldId = `msg-${ids[SEED - 100]}`;
  await expect(A.locator(`#${heldId}`)).toBeAttached();
  const heldTop = await anchoredTop(A, heldId);
  await pageRequest;
  await say(B, "posted while a page is out");
  await expect(pill, "the arrival counts on the pill").toHaveText(
    "1 new message ↓",
  );
  expect(
    Math.abs((await topOf(heldId)) - heldTop),
    "…and does not move the viewed row",
  ).toBeLessThan(3);
  releasePage();
  await expect(list, "the held page lands").toHaveAttribute("data-rows", "151");
  await expect
    .poll(async () => Math.abs((await topOf(heldId)) - heldTop), {
      message: "…with the viewed row still where it was",
    })
    .toBeLessThan(3);
  await A.unroute("**/stoop.chat.v1.ChatService/ListMessages");

  // The pill takes the way back to the bottom.
  await pill.click();
  await expect(pill, "Jump to latest hides the pill").toHaveCount(0);
  await expect
    .poll(atBottom, { message: "…and lands at the bottom" })
    .toBe(true);
  await expect(
    rowOf(ids[SEED - 1]),
    "…with the newest message on screen",
  ).toBeVisible();

  // An arrival while at the bottom is followed; one while scrolled up is
  // counted on the pill and does not move the view.
  await say(B, "hello from bea");
  await expect(
    A.locator(".message", { hasText: "hello from bea" }),
    "an arrival at the bottom is shown",
  ).toBeVisible();
  await expect
    .poll(atBottom, { message: "…and the view follows it" })
    .toBe(true);

  await list.evaluate((e) => {
    e.scrollTop = e.scrollHeight / 2;
  });
  await expect(pill, "scrolled up, the pill is back").toHaveText(
    "Jump to latest ↓",
  );
  const topBefore = await scrollTop();
  await say(B, "and again");
  await expect(pill, "an arrival counts on the pill").toHaveText(
    "1 new message ↓",
  );
  expect(
    Math.abs((await scrollTop()) - topBefore),
    "…and doesn't move the view",
  ).toBeLessThan(3);
});

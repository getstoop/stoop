import { BASE } from "../e2e/seed.mjs";
import { expect, gotoShared, pastGate, say, seed, signIn, test } from "./lib";

declare global {
  interface Window {
    __copied?: string;
  }
}

// Windowed history (STOOP-57): jumping to a message that isn't loaded
// replaces the timeline with one page around it; scrolling down pages
// forward until the window is live again; the DOM never holds more than
// WINDOW_CAP rows; arrivals while windowed count on the pill; ?m= deep
// links open around a message.
// Ported from web/e2e/window.mjs (STOOP-238). The viewport the puppeteer
// harness launched with is set on the contexts here.
// Enough to prove the cap, with one page of margin and no more. The
// window grows HISTORY_PAGE (50) per forward page, so it reaches CAP on
// the sixth and has to prune on the seventh; 400 gives an eighth. The
// jump target (message 5) also has to sit outside a full window, which
// anything over CAP satisfies.
const SEED = 400;
const CAP = 300;
// The permalink target must sit far from both ends, or the page loaded
// around it merges with the tail and the window holds more than one
// page. Derived, not hardcoded: this was ids[299] when SEED was 600.
const MID = SEED / 2 - 1;
const VIEWPORT = { width: 1100, height: 700 };

test("windowed history, jumps, the cap and ?m= deep links", async ({
  browser,
}) => {
  // This spec seeds SEED messages and pages through all of them; the
  // config's 60 s is thin, especially on a CI runner.
  test.setTimeout(180_000);

  const { tokens, space, channels } = await seed();
  const spaceId = space.id;
  const channelId = channels.general;
  const channelPath = `/s/${spaceId}/c/${channelId}`;

  // Seed SEED messages; the last one quotes #5 so a reply jump has to
  // leave the loaded window far behind.
  //
  // Over RPC from Node, before any page is open: sends issued from
  // inside the browser each cost a round trip, and an open timeline
  // re-renders on every arrival — close to four minutes on a GitHub
  // runner. Numbering must stay in order (the spec reads back "message
  // N"), so the sends are still sequential.
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
        // The quoted message is long since sent by the time the last one is.
        replyToMessageId: i === SEED ? ids[4] : "",
      }),
    });
    if (!res.ok) throw new Error(`seeding message ${i}: HTTP ${res.status}`);
    ids.push((await res.json()).message.id);
  }

  const A = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  const messages = A.locator(".message");
  const list = A.locator(".message-list");
  const pill = A.locator(".jump-latest");
  const lines = A.locator(".message-content .md-lines");
  const lastLine = lines.last();
  const start = A.locator(".history-start");
  const scrollTop = () => list.evaluate((e) => e.scrollTop);
  const scrollToBottom = () =>
    list.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
  const atBottom = () =>
    list.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 40);
  // The seeded quote sits on the newest message (the foot row is the
  // list's last child, so :last-of-type won't find it).
  const clickLastQuote = () =>
    A.locator(".message .reply-quote").last().click();
  const centred = (id: string) =>
    A.evaluate((id) => {
      const el = document.getElementById(`msg-${id}`);
      const list = document.querySelector(".message-list");
      if (!el || !list) return false;
      const r = el.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      return r.top >= l.top && r.bottom <= l.bottom;
    }, id);

  await signIn(A, tokens.ada, channelPath);
  await pastGate(A);
  await expect(messages, "opens on the latest page").toHaveCount(50);
  // Was a flat 1200 ms. What it waited for is the opening scroll landing,
  // so that it can't clobber the jump below — not that it landed at the
  // bottom specifically (a "New messages" line would take it elsewhere).
  await expect
    .poll(scrollTop, { message: "the opening scroll has landed" })
    .toBeGreaterThan(0);

  // Jump to the quoted message: one window around it, nothing else.
  await clickLastQuote();
  await expect(
    A.locator(`#msg-${ids[4]}`),
    "the quoted message is loaded after one jump",
  ).toHaveCount(1);
  // Proving nothing *else* loaded needs time to pass, so this one stays.
  await A.waitForTimeout(300);
  const n1 = await messages.count();
  expect(
    n1,
    `…as a window around it, not the whole history (${n1} rows)`,
  ).toBeLessThan(50);
  await expect(
    lines.first(),
    "the window starts at the channel's beginning",
  ).toHaveText("message 1");
  await expect(start, "…and says so").toHaveCount(1);
  await expect
    .poll(() => centred(ids[4]), {
      message: "the quoted message is on screen",
    })
    .toBe(true);
  await expect(
    pill,
    "a 'Jump to latest' pill is offered while the window isn't live",
  ).toHaveText("Jump to latest ↓");

  // Paging forward: scroll to the window's end until it's live. Along the
  // way the DOM stays capped and the beginning marker goes away as the
  // oldest rows are pruned.
  let maxRows = 0;
  let lastText = await lastLine.innerText();
  for (let i = 0; i < 20 && lastText !== `message ${SEED}`; i++) {
    await scrollToBottom();
    // The original slept 600 ms here; this waits for the forward page to
    // actually arrive, and keeps the outer retry for a scroll that never
    // reached a fetch. The row cap is applied in the same update as the
    // append (api/history.ts), so sampling now can't catch a fat frame.
    const before = lastText;
    for (let w = 0; w < 60 && lastText === before; w++) {
      await A.waitForTimeout(100);
      lastText = await lastLine.innerText();
    }
    maxRows = Math.max(maxRows, await messages.count());
  }
  expect(
    lastText,
    `scrolled forward to the newest message (last: ${lastText})`,
  ).toBe(`message ${SEED}`);
  expect(
    maxRows,
    `the timeline never held more than ${CAP} rows (max ${maxRows})`,
  ).toBeLessThanOrEqual(CAP);
  expect(maxRows, `…and did reach the cap (${maxRows})`).toBe(CAP);
  await expect(
    start,
    "the beginning marker is gone once the oldest rows were pruned",
  ).toHaveCount(0);
  // The last page is appended below the anchored view, so the pill still
  // offers the way down; scrolling there dismisses it.
  await scrollToBottom();
  await expect(
    pill,
    "the pill disappears once the window is live and at the bottom",
  ).toHaveCount(0);

  // Windowed again while someone else talks: their message counts on the
  // pill and the view doesn't move; the pill brings back the newest page.
  await clickLastQuote();
  await expect(
    A.locator(`#msg-${ids[4]}`),
    "jumped back into history",
  ).toHaveCount(1);
  await A.waitForTimeout(300);
  const B = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();
  const topBefore = await scrollTop();
  const rowsBefore = await messages.count();
  await say(B, "hello from bea");
  await expect(pill, "someone else's message counts on the pill").toHaveText(
    "1 new message ↓",
  );
  await expect(messages, "…is not spliced into the window").toHaveCount(
    rowsBefore,
  );
  expect(
    Math.abs((await scrollTop()) - topBefore),
    "…and doesn't move the view",
  ).toBeLessThan(3);

  await pill.click();
  await expect(lastLine, "the pill fetches the newest page").toHaveText(
    "hello from bea",
  );
  await A.waitForTimeout(300);
  const n2 = await messages.count();
  expect(n2, `…as one page (${n2} rows)`).toBeLessThanOrEqual(51);
  await expect
    .poll(atBottom, { message: "…scrolled to the bottom" })
    .toBe(true);
  await expect(pill, "…and the pill is gone").toHaveCount(0);

  // Sending from inside history lands the message at the bottom, live.
  // (bea's message has no quote; jump via the seeded one instead — the
  // original's speculative click at .message:last-of-type never matched.)
  await A.locator(`#msg-${ids[SEED - 1]} .reply-quote`).click();
  await expect(
    A.locator(`#msg-${ids[4]}`),
    "jumped into history once more",
  ).toHaveCount(1);
  await say(A, "back to now");
  await expect(
    lastLine,
    "sending from inside history returns to the newest page",
  ).toHaveText("back to now");
  await expect
    .poll(atBottom, { message: "…with the sent message in view" })
    .toBe(true);

  // Copy link hands over the permalink this spec then follows.
  await A.evaluate(() => {
    navigator.clipboard.writeText = (t: string) => {
      window.__copied = t;
      return Promise.resolve();
    };
  });
  const last = messages.last();
  await last.hover();
  const lastId = await last
    .locator(".message-actions")
    .getAttribute("data-message");
  await last.locator('.message-action[title="Copy link"]').click();
  await expect
    .poll(() => A.evaluate(() => window.__copied), {
      message: "Copy link copies this message's permalink",
    })
    .toBe(`${BASE}${channelPath}?m=${lastId}`);
  await expect(
    A.locator('.message-action[title="Copied!"]'),
    "…and the action says it copied",
  ).toHaveCount(1);

  // Deep link: ?m= opens the channel around the message and then drops the
  // param — but the gate stands in front of it first, before the channel
  // opens and clears its unread marker.
  const channelName = await A.locator(".channel-title").innerText();
  await A.goto(`${channelPath}?m=${ids[MID]}`);
  await A.locator(".open-in-app").waitFor({ state: "attached" });
  const card = await A.locator(".login-card").innerText();
  expect(
    (await A.locator(".message-list").count()) === 0 &&
      card.includes("shared a message") &&
      !card.includes(channelName),
    `a permalink lands on the choice, naming no channel (${JSON.stringify(card)})`,
  ).toBe(true);
  // The link it hands the shell, resolved the way the shell resolves it —
  // its `path` against the server it names (deeplink.ts → targetUrl).
  const deep = new URL(
    (await A.locator(".open-in-app a").getAttribute("href")) ?? "",
  );
  const server = deep.searchParams.get("server");
  const target = new URL(deep.searchParams.get("path") ?? "", `${server}/`);
  expect(
    deep.protocol === "stoop:" &&
      server === BASE &&
      target.pathname === channelPath &&
      target.searchParams.get("m") === ids[MID],
    `the handoff names this server and this message (${target.href})`,
  ).toBe(true);
  await A.locator(".open-in-app button").click();
  await expect(
    A.locator(`#msg-${ids[MID]}`),
    "?m= opens the channel with the message loaded",
  ).toHaveCount(1);
  await expect
    .poll(() => centred(ids[MID]), { message: "…on screen" })
    .toBe(true);
  await A.waitForTimeout(400);
  const n3 = await messages.count();
  expect(n3, `…in one window (${n3} rows)`).toBeLessThanOrEqual(50);
  await expect
    .poll(() => new URL(A.url()).searchParams.has("m"), {
      message: "…and the param is dropped from the URL",
    })
    .toBe(false);

  // A bogus id falls back to the newest page rather than an empty timeline.
  await gotoShared(A, `${channelPath}?m=00000000-0000-7000-8000-000000000000`);
  await expect(
    lastLine,
    "an unknown ?m= falls back to the newest page",
  ).toHaveText("back to now");
});

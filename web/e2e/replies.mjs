import { harness, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { suffix, tokens } = await seed({ channels: ["general"] });
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const lastQuote = (p) =>
  p
    .evaluate(() => {
      const msgs = document.querySelectorAll(".message");
      return (
        msgs[msgs.length - 1]?.querySelector(".reply-quote")?.innerText ?? ""
      );
    })
    .catch(() => "");

const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });

await A.type(".composer textarea", "anyone up for pizza?");
await A.keyboard.press("Enter");
await sleep(800);
await A.click(".space-pill.avatar");
await sleep(400); // A looks away so the alert isn't auto-read

// B replies via the hover action.
await B.hover(".message");
await B.click('.message .message-action[title="Reply"]');
check(
  await waitFor(async () => {
    const bar = await text(B, ".reply-bar");
    return bar.includes(`Replying to ada${suffix}`) && bar.includes("pizza");
  }),
  "reply bar shows who and what",
);
await B.type(".composer textarea", "yes! 7pm?");
await B.keyboard.press("Enter");
check(
  await waitFor(async () => (await B.$(".reply-bar")) === null),
  "reply bar clears after sending",
);
let quote = "";
check(
  await waitFor(async () => {
    quote = await lastQuote(B);
    return (
      quote.includes(`ada${suffix}`) && quote.includes("anyone up for pizza?")
    );
  }),
  `reply shows a quote of the original (${JSON.stringify(quote)})`,
);

// A is notified with "replied to you".
check(
  await waitFor(async () => (await A.$(".activity .pill-dot")) !== null),
  "A gets an activity item",
);
await A.click(".activity");
check(
  await waitFor(async () =>
    (await text(A, ".activity-row")).includes(
      `bea${suffix} replied to you in #general`,
    ),
  ),
  "timeline says 'replied to you'",
);
await A.click(".activity-row.unread");
check(
  await waitFor(async () => (await A.$(".activity .pill-dot")) === null),
  "opening it clears the badge",
);
await sleep(1200);

// Clicking the quote jumps to (and flashes) the original.
await A.click(".reply-quote");
check(
  await waitFor(async () =>
    (
      await A.$eval(".message.flash", (e) => e.innerText).catch(() => "")
    ).includes("anyone up for pizza?"),
  ),
  "clicking the quote flashes the original",
);

// Esc cancels a pending reply; self-reply makes no activity item.
await A.hover(".message");
await A.click('.message .message-action[title="Reply"]');
check(
  await waitFor(async () => (await A.$(".reply-bar")) !== null),
  "Reply opens the bar",
);
await sleep(200);
await A.keyboard.press("Escape");
check(
  await waitFor(async () => (await A.$(".reply-bar")) === null),
  "Esc cancels the reply",
);
await sleep(200);
await A.hover(".message");
await A.click('.message .message-action[title="Reply"]');
await sleep(200);
await A.type(".composer textarea", "replying to myself");
await A.keyboard.press("Enter");
await sleep(1000);
check(
  (await A.$(".activity .pill-dot")) === null &&
    (await lastQuote(A)).includes("pizza"),
  "self-reply quotes but doesn't notify",
);

await done();

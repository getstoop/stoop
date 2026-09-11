import {
  acceptDialog,
  harness,
  reloadShared,
  seed,
  signIn,
  sleep,
  waitFor,
} from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { tokens } = await seed();
const path = (p) => new URL(p.url()).pathname;
const channelLink = async (p, name) => {
  for (const l of await p.$$(".channel-link")) {
    if ((await p.evaluate((e) => e.textContent, l)).includes(name)) return l;
  }
  return null;
};
const isBold = (p, name) =>
  channelLink(p, name).then((l) =>
    p.evaluate((e) => e.classList.contains("unread"), l),
  );
const say = async (p, text) => {
  await p.type(".composer textarea", text);
  await p.keyboard.press("Enter");
  await sleep(600);
};

// A sits in #random, B in #general; both are already members (seeded).
const A = await newPage("A");
await signIn(A, tokens.ada);
await (await channelLink(A, "random")).click();
await sleep(600);
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });

// Fresh channels: nothing bold anywhere.
check(
  !(await isBold(A, "general")) && !(await isBold(A, "random")),
  "A: nothing unread to start",
);
check(
  !(await isBold(B, "general")) && !(await isBold(B, "random")),
  "B: nothing unread to start",
);

// A is in #random; B posts in #general → bold for A, not for B (author).
await say(B, "anyone here?");
check(
  await waitFor(() => isBold(A, "general")),
  "A: #general goes bold when B posts there",
);
await sleep(600);
check(
  !(await isBold(B, "general")),
  "B: own message doesn't make #general bold",
);
check(
  await waitFor(async () => (await A.$(".space-rail-list .pill-dot")) !== null),
  "A: the space pill shows a dot while a channel in it is unread",
);

await say(B, "second one");
await sleep(600);

// A opens #general → read; bold clears; the divider sits before the first new message.
await (await channelLink(A, "general")).click();
check(
  await waitFor(async () => !(await isBold(A, "general"))),
  "A: opening the channel clears bold",
);
await sleep(1200);
check(
  (await A.$eval(".new-divider", (e) => e.textContent).catch(() => "")) ===
    "New messages" &&
    (await A.$eval(
      ".new-divider",
      (e) =>
        e.nextElementSibling?.querySelector(".message-content")?.textContent,
    ).catch(() => "")) === "anyone here?",
  "A: 'New messages' divider appears before the first unread message",
);
check(
  (
    await A.$$eval(".day-divider", (els) => els.map((e) => e.textContent))
  ).join() === "Today",
  "one day separator, reading 'Today'",
);
check(
  (await A.$eval(".message-time", (e) => e.title)).includes(
    String(new Date().getFullYear()),
  ),
  "timestamps carry the full date on hover",
);

// A message that lands in the channel A is viewing stays read.
await say(B, "still here?");
await sleep(600);
check(
  !(await isBold(A, "general")),
  "A: message in the open channel is read immediately",
);
check(
  (await A.$eval(".new-divider", (e) => e.textContent).catch(() => "")) ===
    "New messages",
  "A: divider stays put while reading",
);
await (await channelLink(A, "random")).click();
await sleep(400);
await (await channelLink(A, "general")).click();
await sleep(800);
check(
  (await A.$(".new-divider")) === null,
  "A: reopening a fully read channel shows no divider",
);

// A posts in #random; B (in #general) sees #random bold; opening it clears.
await (await channelLink(A, "random")).click();
await sleep(600);
await say(A, "psst, random");
check(await waitFor(() => isBold(B, "random")), "B: #random goes bold");
await sleep(600);
await (await channelLink(B, "random")).click();
check(
  await waitFor(async () => !(await isBold(B, "random"))),
  "B: opening #random clears it",
);
await sleep(1200);

// Space dot: A makes a second space and sits there; B posts in Stoop HQ → dot on A's Stoop HQ pill.
await A.click('button[title="Create a space"]');
await acceptDialog(A, "Second");
await sleep(1500);
await say(B, "over here");
check(
  await waitFor(async () => (await A.$(".space-rail-list .pill-dot")) !== null),
  "A: unread dot on the other space's pill",
);
await A.click(".space-rail-list a.space-pill");
check(
  await waitFor(
    async () =>
      (await A.$(".space-rail-list .pill-dot")) !== null &&
      (await isBold(A, "random")),
  ),
  "A: back in Stoop HQ on #general, #random (where B posted) is bold and the dot stays",
);
await (await channelLink(A, "random")).click();
check(
  await waitFor(
    async () =>
      (await A.$(".space-rail-list .pill-dot")) === null &&
      !(await isBold(A, "random")),
  ),
  `A: reading #random clears both (${path(A)})`,
);

// Persistence: B reloads; state survives (server-side marker).
await reloadShared(B, { waitUntil: "networkidle0" });
await sleep(800);
check(
  !(await isBold(B, "random")) && !(await isBold(B, "general")),
  "B: read state survives reload",
);

await done();

import { harness, joinSpace, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { browser, check, wire, newPage, done } = await harness({
  dialogs: true,
});
// bea and cal exist but are outside the space: the member count has to
// grow as each of them arrives through the invite.
const { suffix, tokens, invite } = await seed({
  users: ["ada", "bea", "cal"],
  members: ["ada"],
  channels: ["general"],
  invite: true,
});
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const onlineNames = (p) =>
  p.$$eval(".member-row.online .member-name", (els) =>
    els.map((e) => e.textContent),
  );

const A = await newPage("A");
await signIn(A, tokens.ada);
check(
  await waitFor(async () =>
    (await text(A, ".members-heading")).toLowerCase().includes("1/1 online"),
  ),
  "A alone: 1/1 online",
);

// B joins: both sides show two online.
const Bctx = await browser.createBrowserContext();
const B = wire(await Bctx.newPage(), "B");
await joinSpace(tokens.bea, invite.code);
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });
check(
  await waitFor(
    async () =>
      (await text(A, ".members-heading"))
        .toLowerCase()
        .includes("2/2 online") &&
      (await onlineNames(A)).includes(`bea${suffix}`),
  ),
  "A sees B come online",
);
check(
  await waitFor(async () =>
    (await text(B, ".members-heading")).toLowerCase().includes("2/2 online"),
  ),
  "B's Ready snapshot lists both online",
);

// Typing indicator: B types → A sees it; it expires after B stops.
await B.type(".composer textarea", "thinking about it");
check(
  await waitFor(
    async () =>
      (await text(A, ".typing-indicator")) === `bea${suffix} is typing…`,
  ),
  "A sees 'bea is typing…'",
);
check(
  (await text(B, ".typing-indicator")) === "",
  "B doesn't see their own typing",
);
check(
  await waitFor(async () => (await text(A, ".typing-indicator")) === "", {
    timeout: 15000,
  }),
  "typing hint expires after silence",
);
await B.click(".composer textarea", { count: 3 });
await B.keyboard.press("Backspace");

// Profile card shows presence.
await A.click(".member-row.online");
check(
  await waitFor(async () => (await text(A, ".user-card")).includes("online")),
  "profile card says online",
);
await A.keyboard.press("Escape");

// @here from the owner: picker offers it; B (online) is notified. A third
// member who is offline is not.
const C = await newPage("C");
await joinSpace(tokens.cal, invite.code);
await signIn(C, tokens.cal);
await C.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);
await C.browserContext().close();
check(
  await waitFor(async () =>
    (await text(A, ".members-heading")).toLowerCase().includes("2/3 online"),
  ),
  "A sees cal offline after closing (2/3 online)",
);
await B.click(".space-pill.avatar");
await sleep(400); // B looks away so the alert isn't auto-read
await A.type(".composer textarea", "@he");
check(
  await waitFor(async () =>
    (await text(A, ".mention-picker")).includes("Everyone online right now"),
  ),
  "picker offers @here",
);
await A.keyboard.press("Enter");
await A.type(".composer textarea", "standup in 5");
await A.keyboard.press("Enter");
check(
  await waitFor(async () => (await B.$(".activity .pill-dot")) !== null),
  "online member is notified by @here",
);
// cal logs back in: nothing waiting.
const C2 = await newPage("C2");
await signIn(C2, tokens.cal);
await C2.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(1000);
check(
  (await C2.$(".activity .pill-dot")) === null,
  "offline member was not notified by @here",
);

// B closes: A sees B offline.
await Bctx.close();
check(
  await waitFor(async () => !(await onlineNames(A)).includes(`bea${suffix}`)),
  "A sees B go offline",
);
await sleep(1000);

await done();

import { harness, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { browser, check, wire, done } = await harness();
const { suffix, tokens } = await seed({ users: ["ada", "friend"] });

// A owns the space and admins the instance.
const A = await (await browser.createBrowserContext()).newPage();
wire(A, "A");
await signIn(A, tokens.ada);
// A renames themselves so we can verify the card fetches fresh.
await A.click(".space-pill.avatar");
await sleep(500);
await A.click("#display-name", { count: 3 });
await A.type("#display-name", "Ada W.");
await A.click('.card button[type="submit"]');
await sleep(600);
await A.goBack();
await sleep(800);
await A.type(".composer textarea", "hello from the owner");
await A.keyboard.press("Enter");
await sleep(600);

// B, a member, says hi.
const B = await (await browser.createBrowserContext()).newPage();
wire(B, "B");
await signIn(B, tokens.friend);
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await B.type(".composer textarea", "hi from a member");
await B.keyboard.press("Enter");
await sleep(800);

// B clicks the owner's name.
const authors = await B.$$(".message-author");
await authors[0].click();
let card = "";
check(
  await waitFor(async () => {
    card = await B.$eval(".user-card", (e) => e.innerText).catch(() => "");
    return card.includes("Ada W.") && card.includes(`@ada${suffix}`);
  }),
  `card shows current display name + handle: ${JSON.stringify(card.split("\n")[0])}`,
);
check(
  /owner/i.test(card) && /server admin/i.test(card),
  "card shows owner + server admin badges",
);
check(/Joined this space/.test(card), "card shows joined date");
await B.keyboard.press("Escape");
check(
  await waitFor(async () => (await B.$(".user-card")) === null),
  "Escape closes the card",
);
await sleep(200);

// A clicks the member's name; then clicking elsewhere closes it.
const aAuthors = await A.$$(".message-author");
await aAuthors[aAuthors.length - 1].click();
let card2 = "";
check(
  await waitFor(async () => {
    card2 = await A.$eval(".user-card", (e) => e.innerText).catch(() => "");
    return (
      card2.includes(`@friend${suffix}`) &&
      /member/i.test(card2) &&
      !/server admin/i.test(card2)
    );
  }),
  "owner sees member card without admin badges",
);
await A.mouse.click(5, 5);
check(
  await waitFor(async () => (await A.$(".user-card")) === null),
  "outside click closes the card",
);
await sleep(300);

await done();

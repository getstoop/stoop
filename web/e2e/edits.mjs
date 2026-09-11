import { acceptDialog, harness, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { tokens } = await seed({ channels: ["general"] });
const contents = (p) =>
  p.$$eval(".message-content", (els) => els.map((e) => e.innerText.trim()));
const actionsOf = async (p, index) => {
  const rows = await p.$$(".message");
  await rows[index].hover();
  return p.evaluate(
    (el) => [...el.querySelectorAll(".message-action")].map((b) => b.title),
    rows[index],
  );
};
const clickAction = async (p, index, label) => {
  const rows = await p.$$(".message");
  await rows[index].hover();
  const btns = await rows[index].$$(".message-action");
  for (const b of btns)
    if ((await p.evaluate((e) => e.title, b)) === label) {
      await b.click();
      return;
    }
  throw new Error(`no ${label} on message ${index}`);
};

const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });

await B.type(".composer textarea", "helo wrld");
await B.keyboard.press("Enter");
await sleep(600);
await A.type(".composer textarea", "owner here");
await A.keyboard.press("Enter");
await sleep(800);

// Actions visible (Add reaction, Copy link and Reply for everyone): B
// (member) sees Edit/Delete on her own, not on A's; A (owner) sees
// Delete on B's.
check(
  JSON.stringify(await actionsOf(B, 0)) ===
    JSON.stringify(["Add reaction", "Copy link", "Reply", "Edit", "Delete"]),
  "member: own message has Reply/Edit/Delete",
);
check(
  await waitFor(
    async () =>
      JSON.stringify(await actionsOf(B, 1)) ===
      JSON.stringify(["Add reaction", "Copy link", "Reply"]),
  ),
  "member: someone else's has only Reply",
);
check(
  await waitFor(
    async () =>
      JSON.stringify(await actionsOf(A, 0)) ===
      JSON.stringify(["Add reaction", "Copy link", "Reply", "Delete"]),
  ),
  "owner: another's message has Reply/Delete (no Edit)",
);

// B edits: inline editor, Enter saves, (edited) marker, A sees it live.
await clickAction(B, 0, "Edit");
await sleep(200);
await B.click(".message-editor textarea", { count: 3 });
await B.type(".message-editor textarea", "hello world");
await B.keyboard.press("Enter");
check(
  await waitFor(
    async () =>
      (await contents(B))[0].startsWith("hello world") &&
      (await B.$(".edited-marker")) !== null,
  ),
  "edit saved with (edited) marker",
);
check(
  await waitFor(
    async () =>
      (await contents(A))[0].startsWith("hello world") &&
      (await A.$(".edited-marker")) !== null,
  ),
  "A sees the edit live",
);
// Esc cancels without saving.
await clickAction(B, 0, "Edit");
await sleep(200);
await B.type(".message-editor textarea", " zzz");
await B.keyboard.press("Escape");
await sleep(300);
check(
  (await contents(B))[0].startsWith("hello world") &&
    !(await contents(B))[0].includes("zzz"),
  "Esc cancels an edit",
);

// A replies to B's message, then B deletes hers: A's reply shows "(message deleted)"; list shrinks live for both.
await clickAction(A, 0, "Reply");
await A.type(".composer textarea", "hi bea");
await A.keyboard.press("Enter");
await sleep(800);
await clickAction(B, 0, "Delete");
await acceptDialog(B);
check(
  await waitFor(async () => {
    const bc = await contents(B),
      ac = await contents(A);
    return (
      !bc.some((c) => c.startsWith("hello world")) &&
      !ac.some((c) => c.startsWith("hello world"))
    );
  }),
  "deleted message disappears for both",
);
check(
  await waitFor(async () =>
    (
      await A.$eval(".reply-quote", (e) => e.innerText).catch(() => "")
    ).includes("message deleted"),
  ),
  "reply quote shows '(message deleted)'",
);

// Owner deletes B's remaining message? B has none left; owner deletes their own reply.
const before = (await contents(A)).length;
await clickAction(A, before - 1, "Delete");
await acceptDialog(A);
check(
  await waitFor(
    async () =>
      (await contents(A)).length === before - 1 &&
      (await contents(B)).length === before - 1,
  ),
  "owner's delete propagates",
);

await done();

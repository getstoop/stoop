import {
  acceptDialog,
  harness,
  seed,
  signIn,
  sleep,
  spaceMenu,
  spaceMenuItems,
  waitFor,
} from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { suffix, tokens } = await seed({
  users: ["ada", "bea", "cal"],
  channels: ["general"],
});

// A owns the seeded space; B and C are members. Each says something, so
// the timeline has an author to click.
const say = async (tag, token, text) => {
  const p = await newPage(tag);
  await signIn(p, token);
  await p.waitForSelector(".composer textarea", { timeout: 8000 });
  await p.type(".composer textarea", text);
  await p.keyboard.press("Enter");
  await sleep(600);
  return p;
};
const A = await say("A", tokens.ada, "welcome all");
const B = await say("B", tokens.bea, `hi from bea${suffix}`);
const C = await say("C", tokens.cal, `hi from cal${suffix}`);

check(
  !(await spaceMenuItems(B)).includes("Invite people"),
  "B (member) is not offered Invite",
);
const panel = await B.$eval(".members-panel", (e) => e.innerText);
check(
  panel.toLowerCase().includes("members · 3") &&
    panel.toLowerCase().includes("owner"),
  `members panel lists 3 with owner badge (${panel.split("\n")[0]})`,
);
await B.click(".member-row");
check(
  await waitFor(async () => (await B.$(".user-card")) !== null),
  "clicking a member opens the profile card",
);
await B.keyboard.press("Escape");
await sleep(200);
check((await spaceMenuItems(B)).includes("Leave space"), "B is offered Leave");
check(
  !(await spaceMenuItems(A)).includes("Leave space"),
  "the owner is not offered Leave",
);

// The card is profile-only now: Message and Block, never roles or
// removal — those live in the space's settings, with a link to them.
const clickAuthor = async (page, name) => {
  const handles = await page.$$(".message-author");
  for (const h of handles) {
    if ((await page.evaluate((e) => e.textContent, h)) === name) {
      await h.click();
      return;
    }
  }
  throw new Error(`author not found: ${name}`);
};
await clickAuthor(A, `bea${suffix}`);
await sleep(800);
await A.waitForSelector(".user-card-actions", { timeout: 3000 });
const actions = await A.$$eval(".user-card-actions button", (es) =>
  es.map((e) => e.textContent),
);
check(
  actions.join(",") === "Message,Block",
  `card offers only Message and Block (${actions.join(", ")})`,
);
check(
  (await A.$(".user-card .card-manage-link")) !== null,
  "the owner's card links to space settings for management",
);
await A.keyboard.press("Escape");
await sleep(200);

// Roles live in Space settings → Members. A promotes B there.
const rowBtn = async (p, rowText, label) => {
  for (const row of await p.$$(".user-row")) {
    if (!(await p.evaluate((e) => e.innerText, row)).includes(rowText))
      continue;
    for (const b of await row.$$(".chip")) {
      if ((await p.evaluate((e) => e.textContent?.trim(), b)) === label)
        return b;
    }
  }
  return null;
};
const openMembersTab = async (p) => {
  await spaceMenu(p, "Space settings");
  await sleep(800);
  await p.click('.settings-tab[data-tab="members"]');
  await sleep(600);
};
await openMembersTab(A);
await (await rowBtn(A, `bea${suffix}`, "Make admin")).click();
check(
  await waitFor(async () =>
    (await spaceMenuItems(B)).includes("Invite people"),
  ),
  "B is offered Invite live after promotion",
);

// B (now admin) in settings: the owner is untouchable, a member is not.
await openMembersTab(B);
const ownerRowChips = await B.evaluate((name) => {
  const row = [...document.querySelectorAll(".user-row")].find((r) =>
    r.innerText.includes(name),
  );
  return [...row.querySelectorAll(".chip")].map((c) => c.textContent);
}, `ada${suffix}`);
check(
  ownerRowChips.length === 0,
  `admin B gets no actions on the owner's row (${ownerRowChips.join(", ")})`,
);
check(
  (await rowBtn(B, `cal${suffix}`, "Kick")) !== null,
  "admin B can act on member C's row",
);

// B kicks C from settings; C is bounced home.
await (await rowBtn(B, `cal${suffix}`, "Kick")).click();
await acceptDialog(B);
check(
  await waitFor(() => new URL(C.url()).pathname === "/"),
  `kicked C bounced to / (${new URL(C.url()).pathname})`,
);
check(
  await waitFor(async () =>
    (await C.$eval("#root", (e) => e.innerText)).includes("Welcome to Stoop"),
  ),
  "C sees the no-spaces home",
);
await B.click(".profile-header .chip");
await sleep(1000);

// B leaves via the sidebar; bounced home.
await spaceMenu(B, "Leave space");
await acceptDialog(B);
check(
  await waitFor(() => new URL(B.url()).pathname === "/"),
  `B left and landed on / (${new URL(B.url()).pathname})`,
);
await A.click(".profile-header .chip");
check(
  await waitFor(async () =>
    (await A.$eval(".members-panel", (e) => e.innerText).catch(() => ""))
      .toLowerCase()
      .includes("members · 1"),
  ),
  "owner's members panel shrinks live",
);
// A's view: only A remains.
const list = await A.evaluate(async () => {
  const r = await fetch("/stoop.chat.v1.ChatService/ListSpaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { spaces } = await r.json();
  const m = await fetch("/stoop.chat.v1.ChatService/ListMembers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId: spaces[0].id }),
  });
  return (await m.json()).members.map((x) => `${x.username}:${x.role}`);
});
check(
  list.length === 1 && list[0].endsWith("SPACE_ROLE_OWNER"),
  `members now: ${list}`,
);

await done();

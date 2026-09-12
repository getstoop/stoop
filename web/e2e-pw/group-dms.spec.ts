import type { Page } from "@playwright/test";
import {
  acceptDialog,
  expect,
  focus,
  gotoShared,
  say,
  seed,
  signIn,
  test,
} from "./lib";

// Group DMs (STOOP-220): start one from the DM list, everybody sees it,
// add a fourth who can read what was already said, and leave — which
// takes the conversation away from the leaver and nobody else.
test("group direct messages", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal", "dee"],
    channels: ["general"],
  });
  const bName = `bea${suffix}`;
  const cName = `cal${suffix}`;
  const dName = `dee${suffix}`;

  const open = async (token: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await p.locator(".composer textarea").waitFor();
    return p;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);
  const D = await open(tokens.dee);

  const dmsPill = (p: Page) => p.locator(".space-pill.dms");
  const candidate = (p: Page, name: string) =>
    p.locator(".candidate-row", { hasText: name });

  // ---- starting one ----
  await dmsPill(A).click();
  await A.locator(".dm-empty").waitFor();
  await A.getByRole("button", { name: "New conversation" }).click();
  await expect(
    A.locator(".candidate-row"),
    "the picker offers the people ada shares a space with",
  ).toHaveCount(3);
  await candidate(A, bName).click();
  await candidate(A, cName).click();
  await expect(
    A.locator(".picked-chips .chip"),
    "picked people become chips",
  ).toHaveCount(2);
  await A.getByRole("button", { name: "Start conversation" }).click();
  await expect(A, "the group opens").toHaveURL(/\/dm\//);
  const dmPath = new URL(A.url()).pathname;
  await expect(
    A.locator(".dm-title"),
    "the header names the people in it",
  ).toContainText(bName);
  await expect(
    A.locator(".dm-title .dm-handle"),
    "…and says how many there are",
  ).toHaveText("3 people");
  await expect(
    A.locator(".dm-link .avatar-stack"),
    "the list row shows two faces",
  ).toHaveCount(1);

  // ---- everyone in it has it ----
  await say(A, "saturday?");
  for (const p of [B, C]) {
    await expect(
      p.locator(".dm-link"),
      "the group is in their DM list",
    ).toHaveCount(1);
    await dmsPill(p).click();
    await expect(p, "…and opens from the pill").toHaveURL(
      new RegExp(`${dmPath}$`),
    );
    await expect(
      p.locator(".message-content", { hasText: "saturday?" }),
      "…with the message in it",
    ).toBeVisible();
  }
  await say(C, "works for me");
  await expect(
    A.locator(".message-content", { hasText: "works for me" }),
    "messages arrive live for everyone",
  ).toBeVisible();

  // ---- adding a fourth ----
  await focus(A);
  await A.getByRole("button", { name: "Add people" }).click();
  await candidate(A, dName).click();
  await A.getByRole("button", { name: "Add to conversation" }).click();
  await expect(A, "the conversation is the same one").toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    A.locator(".dm-title .dm-handle"),
    "the header counts the newcomer",
  ).toHaveText("4 people");
  await expect(
    B.locator(".dm-title .dm-handle"),
    "…for everybody, over the wire",
  ).toHaveText("4 people");
  await dmsPill(D).click();
  await expect(D, "the newcomer lands in it").toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    D.locator(".message-content"),
    "…and reads everything already said",
  ).toHaveCount(2);

  // ---- leaving ----
  await focus(D);
  await D.locator(".chip.dm-leave").click();
  await acceptDialog(D);
  await expect(D, "the leaver is back at the DM list").toHaveURL(/\/dm$/);
  await expect(
    D.locator(".dm-link"),
    "…with the conversation gone",
  ).toHaveCount(0);
  await expect(
    A.locator(".dm-title .dm-handle"),
    "the rest keep it, one person lighter",
  ).toHaveText("3 people");
  await expect(
    A.locator(".message-content"),
    "…and keep every message in it",
  ).toHaveCount(2);
});

// Adding somebody to a 1:1 does not hand them the two people's history:
// it starts a new conversation and leaves the pair alone.
test("adding to a 1:1 forks a new conversation", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const bName = `bea${suffix}`;
  const cName = `cal${suffix}`;

  const open = async (token: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await p.locator(".composer textarea").waitFor();
    return p;
  };
  const A = await open(tokens.ada);
  const C = await open(tokens.cal);

  // A opens a 1:1 with B from the member list and says something private.
  await A.locator(".member-row", { hasText: bName }).click();
  await A.locator(".user-card .message-button").click();
  await A.waitForURL(/\/dm\//);
  const pairPath = new URL(A.url()).pathname;
  await say(A, "just between us");
  await A.locator(".message-content", { hasText: "just between us" }).waitFor();

  // Adding cal forks: a new conversation, empty, with the pair untouched.
  await A.getByRole("button", { name: "Add people" }).click();
  await expect(
    A.locator(".new-conversation p"),
    "the modal says the history does not go with it",
  ).toContainText("Nothing already said here goes with it");
  await A.locator(".candidate-row", { hasText: cName }).click();
  await A.getByRole("button", { name: "Add to conversation" }).click();
  await expect(A, "a different conversation opens").not.toHaveURL(
    new RegExp(`${pairPath}$`),
  );
  await expect(
    A.locator(".message-content"),
    "the fork starts empty",
  ).toHaveCount(0);
  await expect(
    A.locator(".dm-link"),
    "both conversations are in the list",
  ).toHaveCount(2);
  await dmsPillOpen(C);
  await expect(
    C.locator(".message-content"),
    "the newcomer never sees the pair's history",
  ).toHaveCount(0);
  await gotoShared(A, pairPath);
  await expect(
    A.locator(".message-content", { hasText: "just between us" }),
    "the 1:1 still holds it",
  ).toBeVisible();
});

async function dmsPillOpen(page: Page) {
  await page.locator(".space-pill.dms").click();
  await page.waitForURL(/\/dm\//);
}

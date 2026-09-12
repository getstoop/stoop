import type { Page } from "@playwright/test";
import { expect, say, seed, signIn, test } from "./lib";

// Conversations with more than two people (STOOP-220). A conversation is
// its participants: the same set always opens the same one, a smaller set
// is a different one, and membership never changes afterwards.
test("group direct messages", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const aName = `ada${suffix}`;
  const bName = `bea${suffix}`;
  const cName = `cal${suffix}`;

  const open = async (token: string) => {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, token);
    await p.locator(".composer textarea").waitFor();
    return p;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);

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
  ).toHaveCount(2);
  await candidate(A, bName).click();
  await candidate(A, cName).click();
  await expect(
    A.locator(".picked-chips .chip"),
    "picked people become chips",
  ).toHaveCount(2);
  await A.getByRole("button", { name: "Start conversation" }).click();
  await expect(A, "the conversation opens").toHaveURL(/\/dm\//);
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
    // The DM list only exists on /dm, so the pill comes first.
    await dmsPill(p).click();
    await expect(p, "the pill opens the conversation").toHaveURL(
      new RegExp(`${dmPath}$`),
    );
    await expect(
      p.locator(".dm-link"),
      "…the one conversation they are in",
    ).toHaveCount(1);
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

  // ---- a conversation is its people ----
  // Picking the same three lands in the one that exists rather than
  // starting a second, and it still holds what was said.
  await B.getByRole("button", { name: "New conversation" }).click();
  await candidate(B, aName).click();
  await candidate(B, cName).click();
  await B.getByRole("button", { name: "Start conversation" }).click();
  await expect(B, "the same people open the same conversation").toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    B.locator(".dm-link"),
    "…and no second one appears in the list",
  ).toHaveCount(1);
  await expect(
    B.locator(".message-content"),
    "…with the history still in it",
  ).toHaveCount(2);

  // A smaller set is a different conversation: ada and bea alone are not
  // the three of them.
  await B.getByRole("button", { name: "New conversation" }).click();
  await candidate(B, aName).click();
  await B.getByRole("button", { name: "Message" }).click();
  await expect(B, "a subset opens its own conversation").not.toHaveURL(
    new RegExp(`${dmPath}$`),
  );
  await expect(
    B.locator(".message-content"),
    "…which starts empty",
  ).toHaveCount(0);
  await expect(B.locator(".dm-link"), "…and both are in the list").toHaveCount(
    2,
  );

  // ---- membership is fixed ----
  await expect(
    A.getByRole("button", { name: "Add people" }),
    "there is nobody to add",
  ).toHaveCount(0);
  await expect(A.locator(".chip.dm-leave"), "and nothing to leave").toHaveCount(
    0,
  );
});

import type { Locator, Page } from "@playwright/test";
import {
  acceptDialog,
  expect,
  pastGate,
  reload,
  say,
  seed,
  signIn,
  test,
} from "./lib";

// Pronouns and bio (STOOP-118): written on the profile page, read on the
// profile card and nowhere else, cleared by an admin.
// Ported from web/e2e/pronouns.mjs (STOOP-238).
test("pronouns and bio, on the card and nowhere else", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["casey", "robin"],
    channels: ["general"],
  });
  const BIO = "Runs the tool library. Ask me about the bandsaw.";

  // The About you card, found by what it contains rather than its position.
  const ABOUT = '.card:has(input[placeholder="she/her"])';
  const card = (p: Page) => p.locator(".user-card");
  // The gate is decided on the first render, so wait for the app to
  // render something before looking for the way past.
  const authors = (p: Page) => p.locator(".message-author");
  const openCard = async (p: Page, author: Locator) => {
    await author.click();
    await card(p).waitFor();
  };

  // A is the instance admin and space owner.
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.casey);

  // A fills in both fields on their profile.
  await A.locator(".space-pill.avatar").click();
  await A.locator("#pronouns").fill("she/her");
  await A.locator(`${ABOUT} textarea`).fill(BIO);
  await A.locator(`${ABOUT} button[type="submit"]`).click();
  await expect(
    A.locator(`${ABOUT} button[type="submit"]`),
    "Save disables again once there is nothing left to save",
  ).toBeDisabled();
  await expect(
    A.locator(".profile-header p"),
    "profile header echoes the pronouns back",
  ).toContainText("she/her");

  // It survives a reload: the fields came from the server, not local state.
  await reload(A);
  await expect(
    A.locator("#pronouns"),
    "pronouns reload from the server",
  ).toHaveValue("she/her");
  await expect(
    A.locator(`${ABOUT} textarea`),
    "the bio reloads from the server",
  ).toHaveValue(BIO);
  await A.goBack();
  await pastGate(A);
  await say(A, "hello from the owner");

  // B opens A's card from a message.
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.robin);
  await openCard(B, authors(B).first());
  await expect(card(B), "card shows pronouns").toContainText("she/her");
  await expect(card(B), "card shows the bio in full").toContainText(BIO);
  expect(
    await B.locator(".user-card-pronouns").evaluate(
      (e) => getComputedStyle(e.parentElement as Element).whiteSpace,
    ),
    "pronouns sit on the name line, which stays one line",
  ).toBe("nowrap");
  await B.keyboard.press("Escape");

  // The message list itself stays clean — this is the whole point of the
  // card being the only surface.
  await expect(
    B.locator(".message-list"),
    "pronouns do not leak into the message list",
  ).not.toContainText("she/her");
  await expect(
    B.locator(".members-panel"),
    "pronouns do not leak into the members panel",
  ).not.toContainText("she/her");

  // B sets pronouns only, so B's card must show them with no bio.
  await B.locator(".space-pill.avatar").click();
  await B.locator("#pronouns").fill("they/them");
  await B.locator(`${ABOUT} button[type="submit"]`).click();
  // The save has to land before B leaves the page.
  await expect(B.locator(`${ABOUT} button[type="submit"]`)).toBeDisabled();
  await B.goBack();
  await pastGate(B);
  await say(B, "hi from a member");

  // A must have B's message before "the last author" means B.
  await expect(
    A.locator(".message-content", { hasText: "hi from a member" }),
  ).toBeVisible();
  await openCard(A, authors(A).last());
  await expect(card(A), "member's pronouns show on their card").toContainText(
    "they/them",
  );
  await expect(
    card(A).locator(".user-card-bio"),
    "a card with no bio has no bio row, not an empty state",
  ).toHaveCount(0);
  await A.keyboard.press("Escape");

  // The same card inside a DM. This is the case that used to read the
  // participant out of the DM list, which carried neither field.
  await openCard(A, authors(A).last());
  await card(A).locator(".message-button").click();
  await expect(A, "opened a direct message with them").toHaveURL(/\/dm\//);
  // A fresh DM has nothing in it; someone has to say something before
  // there is an author name to click.
  const dmUrl = A.url();
  await say(A, "about that bandsaw");
  await B.goto(dmUrl);
  await pastGate(B);
  await openCard(B, authors(B).first());
  await expect(card(B), "the card in a DM carries the pronouns").toContainText(
    "she/her",
  );
  await expect(card(B), "and the bio").toContainText(BIO);
  await expect(
    card(B),
    "and still says nothing about a space, which a DM has none of",
  ).not.toContainText("Joined this space");
  await B.keyboard.press("Escape");

  // An admin takes the pronouns down. A (the setup user) is the server admin.
  await A.goto("/admin?tab=accounts");
  const theirs = A.locator(".user-row", { hasText: `@robin${suffix}` });
  const mine = A.locator(".user-row", { hasText: `@casey${suffix}` });
  await expect(
    theirs,
    "the accounts row carries pronouns on its meta line",
  ).toContainText("they/them");
  // Bios stay off this list: it is an operational view, not a social one,
  // and a wrapped paragraph per row breaks the ⋮ alignment. The confirm
  // quotes the text instead.
  await expect(mine, "an account with a bio shows pronouns").toContainText(
    "she/her",
  );
  await expect(mine, "but not the bio").not.toContainText(BIO);

  await theirs
    .locator(`button[aria-label="Actions for @robin${suffix}"]`)
    .click();
  const items = A.locator(".dots-menu button");
  await expect(
    items.filter({ hasText: "Clear pronouns" }),
    "the field they have is offered",
  ).toHaveCount(1);
  await expect(
    items.filter({ hasText: "Clear bio" }),
    "and the one they don't, isn't",
  ).toHaveCount(0);
  await items.filter({ hasText: "Clear pronouns" }).click();
  await acceptDialog(A);
  await expect(theirs, "the pronouns are gone from the row").not.toContainText(
    "they/them",
  );

  // And gone for the account itself, which reads it back from the server.
  await B.goto("/profile");
  await expect(
    B.locator("#pronouns"),
    "the account sees the cleared field as empty, not stale",
  ).toHaveValue("");
});

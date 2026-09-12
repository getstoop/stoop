import type { Page } from "@playwright/test";
import { expect, say, seed, signIn, test } from "./lib";

// Pinned messages (STOOP-219): who is offered the pin, the panel behind
// the channel header's pin, the marker on a kept message, the list's
// order and its live updates, the jump, and unpinning from either end.
test("pinned messages", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });
  // A is the space owner (manage_channels); B is a plain member.
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const message = (p: Page, index: number) => p.locator(".message").nth(index);
  const marker = (p: Page, index: number) =>
    message(p, index).locator(".pinned-marker");
  const pinAction = (p: Page, index: number, label: "Pin" | "Unpin") =>
    message(p, index).locator(`.message-action[aria-label="${label}"]`);
  const togglePin = async (p: Page, index: number, label: "Pin" | "Unpin") => {
    await message(p, index).hover();
    await pinAction(p, index, label).click();
  };
  const panel = (p: Page) => p.locator(".pins-panel");
  const rows = (p: Page) => panel(p).locator(".pin-row");
  const openPins = async (p: Page) => {
    await p.locator(".pins-button").click();
    await expect(panel(p)).toBeVisible();
  };
  const closePins = async (p: Page) => {
    await p.keyboard.press("Escape");
    await expect(panel(p), "Escape closes the panel").toHaveCount(0);
  };

  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await say(A, "server address is stoop.example.net");
  await say(A, "be decent to each other");
  await expect(
    B.locator(".message"),
    "B has both messages before anything is pinned",
  ).toHaveCount(2);

  // The pin is in the header for everyone, whether or not anything is
  // pinned — an absent control would be a stranger state than an empty
  // panel. Only the person who can pin is told how.
  await openPins(B);
  await expect(
    panel(B),
    "a member is told the channel keeps nothing",
  ).toHaveText(/Nothing pinned yet/);
  await expect(
    panel(B).locator(".hint"),
    "and is not told to pin, which she cannot do",
  ).toHaveCount(0);
  await closePins(B);
  await openPins(A);
  await expect(
    panel(A).locator(".hint"),
    "someone who can pin is told where the pin lives",
  ).toHaveText(/hover actions/);
  await closePins(A);

  // A member is not offered the pin on any message.
  await message(B, 0).hover();
  await expect(
    message(B, 0).locator(".message-action"),
    "a member's actions on someone else's message stop at Reply",
  ).toHaveCount(3);
  await expect(pinAction(B, 0, "Pin"), "and none of them is Pin").toHaveCount(
    0,
  );

  // A pins the first message: the marker appears on the row, and on B's
  // copy of it live, from the MessagePinned event alone.
  await togglePin(A, 0, "Pin");
  await expect(marker(A, 0), "the message says it is kept").toHaveText(
    /Pinned/,
  );
  await expect(marker(B, 0), "and says so for B without a reload").toHaveText(
    /Pinned/,
  );
  await expect(marker(A, 1), "the other message is untouched").toHaveCount(0);

  // The list is the same for a member, minus the way to undo it.
  await openPins(B);
  await expect(rows(B), "one kept message").toHaveCount(1);
  await expect(rows(B).first(), "the one A pinned").toContainText(
    "server address",
  );
  await expect(
    rows(B).first().locator(".pin-row-by"),
    "with who pinned it",
  ).toHaveText(new RegExp(`Pinned by ada${suffix}`));
  await expect(
    rows(B).locator(".pin-row-unpin"),
    "a member is offered no way to unpin",
  ).toHaveCount(0);
  await closePins(B);

  // A second pin leads the list: most recently pinned first.
  await togglePin(A, 1, "Pin");
  await openPins(A);
  await expect(rows(A), "both are kept").toHaveCount(2);
  await expect(rows(A).first(), "the newest pin leads the list").toContainText(
    "be decent",
  );
  await expect(rows(A).nth(1), "the older one follows").toContainText(
    "server address",
  );
  await expect(
    panel(A).locator(".pins-head"),
    "the head counts them",
  ).toHaveText(/2/);

  // Picking a row closes the panel and lands on that message, the jump
  // activity rows and search results already make. The timeline drops
  // ?m= once it has landed, so the flash is the evidence.
  await rows(A).nth(1).click();
  await expect(panel(A), "picking a row closes the panel").toHaveCount(0);
  await expect(
    A.locator(".message.flash .message-content"),
    "and lands on the message it named",
  ).toContainText("server address");

  // Unpinning from the panel takes the row out and the marker with it,
  // live for B again.
  await openPins(A);
  await rows(A).filter({ hasText: "be decent" }).hover();
  await rows(A)
    .filter({ hasText: "be decent" })
    .locator(".pin-row-unpin")
    .click();
  await expect(rows(A), "the unpinned row leaves the list").toHaveCount(1);
  await expect(marker(A, 1), "and the marker leaves the message").toHaveCount(
    0,
  );
  await expect(marker(B, 1), "for B too, live").toHaveCount(0);
  await closePins(A);

  // And from the message itself: a kept message offers Unpin where an
  // unkept one offers Pin.
  await message(A, 0).hover();
  await expect(
    pinAction(A, 0, "Unpin"),
    "a kept message's action reads Unpin",
  ).toHaveCount(1);
  await togglePin(A, 0, "Unpin");
  await expect(marker(A, 0), "unpinned from the timeline").toHaveCount(0);
  await expect(marker(B, 0), "and for B").toHaveCount(0);
  await openPins(A);
  await expect(panel(A), "the channel keeps nothing again").toHaveText(
    /Nothing pinned yet/,
  );
});

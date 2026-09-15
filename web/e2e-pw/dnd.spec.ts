import type { Page } from "@playwright/test";
import { expect, reload, seed, signIn, test } from "./lib";

// Do not disturb (STOOP-291): stored on the account, so everyone else sees
// it, every device follows it, and it survives a reload. Otherwise presence
// is only online or offline.
test("do not disturb, as everyone else and every device sees it", async ({
  browser,
}) => {
  const { suffix, tokens } = await seed();
  const aName = `ada${suffix}`;
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  await signIn(A, tokens.ada);
  await expect(A.locator(".composer textarea")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

  // A member's dot is only rendered while they are online, so waiting on
  // its class covers "online at all" too.
  const dotFor = (p: Page, name: string) =>
    p.locator(".member-row", { hasText: name }).locator(".online-dot");
  const ownDot = (p: Page) => p.locator(".space-pill.avatar .online-dot");
  const dndMenu = (p: Page) => p.locator("#dnd-duration");

  await expect(dotFor(B, aName), "A starts online for B").toHaveClass(
    /online-dot online/,
  );

  await A.goto("/profile?tab=notifications");
  await dndMenu(A).selectOption("never");
  await expect(ownDot(A), "A's own rail dot shows it").toHaveClass(
    /online-dot dnd/,
  );
  await expect(dotFor(B, aName), "B sees A's dot change live").toHaveClass(
    /online-dot dnd/,
  );

  await B.locator(".member-row", { hasText: aName }).click();
  await expect(
    B.locator(".user-card .presence"),
    "B's card for A says do not disturb",
  ).toHaveText("do not disturb");
  await B.keyboard.press("Escape");

  // Signing in on another device adopts it; nothing about connecting
  // clears it.
  const A2 = await (await browser.newContext()).newPage();
  await signIn(A2, tokens.ada);
  await expect(ownDot(A2), "a second device adopts it").toHaveClass(
    /online-dot dnd/,
  );
  await expect(dotFor(B, aName), "and B still sees it").toHaveClass(
    /online-dot dnd/,
  );

  await reload(A);
  await expect(dndMenu(A), "it survives a reload").toHaveValue("never");

  // A duration shows its end on every device.
  await A2.goto("/profile?tab=notifications");
  await dndMenu(A2).selectOption("1h");
  await expect(dndMenu(A2), "an hour shows as its end").toHaveValue("until");
  await expect(dndMenu(A), "on the first device too").toHaveValue("until");
  await expect(dotFor(B, aName), "and B still sees it").toHaveClass(
    /online-dot dnd/,
  );

  // Turned off on the second device, it ends everywhere.
  await dndMenu(A2).selectOption("off");
  await expect(dotFor(B, aName), "back to online for B").toHaveClass(
    /online-dot online/,
  );
  await expect(dndMenu(A), "and off on A's first device").toHaveValue("off");
});

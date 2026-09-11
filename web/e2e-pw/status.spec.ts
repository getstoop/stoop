import type { Page } from "@playwright/test";
import { expect, reload, seed, signIn, test } from "./lib";

// Presence status (STOOP-71): a chosen status shows on everyone else's
// dots and card, and survives a reload. Mutes live in mutes.spec.ts.
// Ported from web/e2e/status.mjs (STOOP-238).
test("the status a member picks, as everyone else sees it", async ({
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

  await expect(dotFor(B, aName), "A starts online for B").toHaveClass(
    /online-dot online/,
  );

  // A picks Do not disturb on the profile page.
  await A.goto("/profile?tab=notifications");
  const statuses = A.locator(".status-option");
  await expect(statuses, "profile offers three statuses").toHaveCount(3);
  await statuses.filter({ hasText: "Do not disturb" }).click();
  await expect(
    A.locator(".space-pill.avatar .online-dot"),
    "A's own rail dot turns red",
  ).toHaveClass(/online-dot dnd/);
  await expect(dotFor(B, aName), "B sees A's dot go red live").toHaveClass(
    /online-dot dnd/,
  );

  await B.locator(".member-row", { hasText: aName }).click();
  await expect(
    B.locator(".user-card .presence"),
    "B's card for A says do not disturb",
  ).toHaveText("do not disturb");
  await B.keyboard.press("Escape");

  // The status survives a reload (per-browser preference, re-announced).
  await reload(A);
  await expect(
    A.locator(".status-option.active"),
    "the choice survives a reload",
  ).toContainText("Do not disturb");
  await expect(dotFor(B, aName), "and is announced again to B").toHaveClass(
    /online-dot dnd/,
  );

  await A.locator(".status-option").filter({ hasText: "Away" }).click();
  await expect(dotFor(B, aName), "Away shows amber for B").toHaveClass(
    /online-dot away/,
  );
  await A.locator(".status-option").filter({ hasText: "Online" }).click();
  await expect(dotFor(B, aName), "back to Online").toHaveClass(
    /online-dot online/,
  );
});

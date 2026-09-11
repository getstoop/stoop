import type { Page } from "@playwright/test";
import { expect, seed, signIn, test } from "./lib";

// Phone-width layout (STOOP-60): the rail and channel sidebar are a drawer
// behind the menu button, messages reveal their toolbar on tap, and the
// composer doesn't trigger iOS zoom. Ends by checking that a wide window
// gets the three-column layout back.
// Ported from web/e2e/mobile.mjs (STOOP-238).

// The original set this with page.setViewport(); in Playwright touch and
// mobile emulation belong to the context, so the phone page gets its own.
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

// Layout probes, all evaluated in the page.
const layout = (p: Page) =>
  p.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect();
    const menu = document.querySelector(".menu-button");
    return {
      open: !!document.querySelector(".app-shell.drawer-open"),
      backdrop: !!document.querySelector(".nav-backdrop"),
      menuShown: menu ? getComputedStyle(menu).display !== "none" : false,
      sidebarLeft: rect(".channel-sidebar")?.left ?? null,
      sidebarRight: rect(".channel-sidebar")?.right ?? null,
      railLeft: rect(".space-rail")?.left ?? null,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

// The drawer is parked off-screen to the left, so its right edge is at or
// past 0. Number() keeps the original's coercion: a sidebar that isn't
// there at all also reads as off-screen.
const closed = (l: Awaited<ReturnType<typeof layout>>) =>
  !l.open && Number(l.sidebarRight) <= 0;

test("phone layout: drawer, toolbar on tap, and back to three columns", async ({
  browser,
}) => {
  const { tokens } = await seed({ users: ["mob"], channels: ["general"] });

  // Under mobile emulation page.click() can miss a button it had to scroll
  // into view; tap() is the touch path and is what a phone does anyway.
  const P = await (await browser.newContext(phone)).newPage();
  await signIn(P, tokens.mob);

  await expect(P, "landed in a channel").toHaveURL(/\/c\//);
  // Nothing below means anything until the channel has rendered.
  await P.locator(".composer textarea").waitFor();

  let l = await layout(P);
  expect(l.menuShown, "phone: menu button is shown").toBe(true);
  expect(closed(l), "phone: drawer starts closed (off-screen)").toBe(true);
  expect(l.overflow, "phone: no horizontal overflow").toBe(false);

  await P.locator(".menu-button").tap();
  await expect
    .poll(
      async () => {
        l = await layout(P);
        return l.open && l.backdrop;
      },
      { message: "menu button opens the drawer with a scrim" },
    )
    .toBe(true);
  // The scrim is up as soon as the drawer starts moving; the geometry below
  // is only true once it has finished, so poll for the settled position.
  await expect
    .poll(
      async () => {
        l = await layout(P);
        return l.railLeft === 0 && l.sidebarLeft === 68;
      },
      { message: "drawer shows rail at 0 and sidebar at 68" },
    )
    .toBe(true);

  await P.locator(".channel-link").first().tap();
  await expect
    .poll(async () => closed(await layout(P)), {
      message: "picking a channel closes the drawer",
    })
    .toBe(true);

  await P.locator(".menu-button").tap();
  await P.keyboard.press("Escape");
  await expect
    .poll(async () => (await layout(P)).open, {
      message: "Escape closes the drawer",
    })
    .toBe(false);

  await P.locator(".menu-button").tap();
  // tap(selector) aims at the element's centre, which is under the drawer
  // panel (it covers the left 348px); the scrim is the strip beside it.
  await P.touchscreen.tap(372, 420);
  await expect
    .poll(async () => (await layout(P)).open, {
      message: "tapping the scrim closes the drawer",
    })
    .toBe(false);

  // Messages: the toolbar shows on tap, since touch has no hover.
  const composer = P.locator(".composer textarea");
  await composer.click();
  const fontSize = await composer.evaluate((e) => getComputedStyle(e).fontSize);
  expect(fontSize, `composer is 16px on a phone (${fontSize})`).toBe("16px");
  await composer.pressSequentially("hello from a phone");
  await P.keyboard.press("Enter");

  const toolbar = P.locator(".message .message-toolbar").first();
  await toolbar.waitFor({ state: "attached" });
  const before = await toolbar.evaluate((t) => getComputedStyle(t).opacity);
  expect(before, "toolbar hidden before the tap").toBe("0");

  await P.locator(".message .message-content").first().tap();
  await expect
    .poll(
      () =>
        P.evaluate(() => {
          const m = document.activeElement?.closest(".message");
          const t = m?.querySelector(".message-toolbar");
          return t ? getComputedStyle(t).opacity : "no-focus";
        }),
      { message: "tapping a message shows its toolbar" },
    )
    .toBe("1");

  // Other pages carry the menu button too, and following a rail link closes
  // the drawer.
  await P.goto("/profile");
  await expect
    .poll(async () => (await layout(P)).menuShown, {
      message: "profile page has the menu button",
    })
    .toBe(true);
  await P.locator(".menu-button").tap();
  await P.locator(".space-pill.activity").tap();
  await expect
    .poll(
      async () => {
        l = await layout(P);
        return !l.open && new URL(P.url()).pathname === "/activity";
      },
      { message: "rail link navigates and closes the drawer" },
    )
    .toBe(true);

  // Wide window: everything back in the flow, no drawer. The original
  // widened the viewport, which in puppeteer also dropped isMobile and
  // hasTouch; in Playwright those are fixed for the life of a context, so
  // the wide window is a second, plain one.
  const D = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 } })
  ).newPage();
  await signIn(D, tokens.mob);
  await D.locator(".composer textarea").waitFor();
  const w = await layout(D);
  expect(w.menuShown, "desktop: menu button hidden").toBe(false);
  expect(
    w.railLeft === 0 && w.sidebarLeft === 68,
    "desktop: rail and sidebar in the flow",
  ).toBe(true);
});

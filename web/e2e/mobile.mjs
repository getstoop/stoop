// Phone-width layout (STOOP-60): the rail and channel sidebar are a drawer
// behind the menu button, messages reveal their toolbar on tap, and the
// composer doesn't trigger iOS zoom. Ends by checking that a wide window
// gets the three-column layout back.
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const phone = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const suffix = String(Date.now() % 1000000);
const user = `mob${suffix}`,
  pass = "correct horse battery";

const P = await (await browser.createBrowserContext()).newPage();
P.on("pageerror", (e) => {
  console.log("[pageerror]", e.message);
  fails++;
});
await P.setViewport(phone);
await P.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
// Under mobile emulation page.click() can miss a button it had to scroll
// into view; tap() is the touch path and is what a phone does anyway.
if (new URL(P.url()).pathname === "/setup") {
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.tap('button[type="submit"]');
  await sleep(1500);
  await P.type('input[placeholder="The Porch"]', "Stoop HQ");
  await P.tap('button[type="submit"]');
  await sleep(1500);
  await P.tap("button.reach-continue");
  await sleep(800);
  await P.tap("button.primary");
  await sleep(1500);
} else {
  await P.tap("button.link");
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.tap('button[type="submit"]');
  await sleep(2000);
}
check(P.url().includes("/c/"), "landed in a channel");

// Layout probes, all evaluated in the page.
const layout = () =>
  P.evaluate(() => {
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
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

let l = await layout();
check(l.menuShown, "phone: menu button is shown");
check(
  !l.open && l.sidebarRight <= 0,
  "phone: drawer starts closed (off-screen)",
);
check(!l.overflow, "phone: no horizontal overflow");

await P.tap(".menu-button");
await sleep(400);
l = await layout();
check(l.open && l.backdrop, "menu button opens the drawer with a scrim");
check(
  l.railLeft === 0 && l.sidebarLeft === 68,
  "drawer shows rail at 0 and sidebar at 68",
);

await P.tap(".channel-link");
await sleep(400);
l = await layout();
check(!l.open && l.sidebarRight <= 0, "picking a channel closes the drawer");

await P.tap(".menu-button");
await sleep(300);
await P.keyboard.press("Escape");
await sleep(300);
check(!(await layout()).open, "Escape closes the drawer");

await P.tap(".menu-button");
await sleep(300);
// tap(selector) aims at the element's centre, which is under the drawer
// panel (it covers the left 348px); the scrim is the strip beside it.
await P.touchscreen.tap(372, 420);
await sleep(300);
check(!(await layout()).open, "tapping the scrim closes the drawer");

// Messages: the toolbar shows on tap, since touch has no hover.
await P.click(".composer textarea");
const fontSize = await P.$eval(
  ".composer textarea",
  (e) => getComputedStyle(e).fontSize,
);
check(fontSize === "16px", `composer is 16px on a phone (${fontSize})`);
await P.type(".composer textarea", "hello from a phone");
await P.keyboard.press("Enter");
await sleep(800);
const before = await P.$eval(
  ".message .message-toolbar",
  (t) => getComputedStyle(t).opacity,
);
check(before === "0", "toolbar hidden before the tap");
await P.tap(".message .message-content");
await sleep(300);
const after = await P.evaluate(() => {
  const m = document.activeElement?.closest(".message");
  const t = m?.querySelector(".message-toolbar");
  return t ? getComputedStyle(t).opacity : "no-focus";
});
check(after === "1", `tapping a message shows its toolbar (${after})`);

// Other pages carry the menu button too, and following a rail link closes
// the drawer.
await P.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(400);
check((await layout()).menuShown, "profile page has the menu button");
await P.tap(".menu-button");
await sleep(300);
await P.tap(".space-pill.activity");
await sleep(600);
l = await layout();
check(
  !l.open && new URL(P.url()).pathname === "/activity",
  "rail link navigates and closes the drawer",
);

// Wide window: everything back in the flow, no drawer.
await P.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await P.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(600);
l = await layout();
check(!l.menuShown, "desktop: menu button hidden");
check(
  l.railLeft === 0 && l.sidebarLeft === 68,
  "desktop: rail and sidebar in the flow",
);

await browser.close();
console.log(fails ? `${fails} failure(s)` : "all passed");
process.exit(fails ? 1 : 0);

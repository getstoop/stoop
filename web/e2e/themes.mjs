// Themes: the profile's Appearance cards apply a theme immediately, it is
// stamped on <html data-theme> and survives a reload (localStorage), the
// page's colours actually change, "follow system" picks the dark/light
// pair by the OS setting, and nothing on the server is involved.
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
const A = await (await browser.createBrowserContext()).newPage();
A.on("pageerror", (e) => {
  console.log("[A pageerror]", e.message);
  fails++;
});
A.on("dialog", (d) => d.accept());
const suffix = String(Date.now() % 1000000);
const themeOf = () => A.evaluate(() => document.documentElement.dataset.theme);
const bgOf = (sel) => A.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
const stored = () => A.evaluate(() => localStorage.getItem("stoop.theme"));

await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
await A.click("button.primary");
await sleep(1500);

check((await themeOf()) === "brownstone", "fresh browser starts on Brownstone");
const darkBg = await bgOf("body");

await A.goto(`${base}/profile?tab=appearance`, { waitUntil: "networkidle0" });
await sleep(500);
const cards = await A.$$eval(".theme-card", (els) =>
  els.map((e) => e.dataset.theme),
);
check(
  cards.join() ===
    "brownstone,daylight,dusk,bodega,newsprint,blackout,fire-escape,nightcap,night-bus,mailbox",
  `ten theme cards (${cards.join(", ")})`,
);
check(
  (await A.$eval(".theme-card.active", (e) => e.dataset.theme)) ===
    "brownstone",
  "current theme is marked active",
);

// Each card is painted by its own theme, not the page's.
// (Fire Escape shares Brownstone's grounds and differs in accent, so the
// identity of a palette is ground + accent.)
const cardKeys = await A.$$eval(".theme-card", (els) =>
  els.map((e) => {
    const mock = e.querySelector(".theme-mock");
    const av = e.querySelector(".theme-mock-av");
    return `${getComputedStyle(mock).backgroundColor}|${getComputedStyle(av).backgroundColor}`;
  }),
);
check(
  new Set(cardKeys).size === cardKeys.length,
  "every card previews a distinct palette",
);

// Pick Daylight: stamped, stored, and the page turns light.
await A.click('.theme-card[data-theme="daylight"]');
await sleep(300);
check((await themeOf()) === "daylight", "clicking a card stamps data-theme");
check(
  JSON.parse(await stored())?.theme === "daylight",
  "choice is saved in localStorage",
);
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(800);
check((await themeOf()) === "daylight", "theme survives navigation and reload");
check(
  (await bgOf(".message-list")) !== darkBg,
  "the timeline is actually painted differently",
);

// Follow system: dark OS → the dark half (Brownstone), light OS → Daylight.
await A.goto(`${base}/profile?tab=appearance`, { waitUntil: "networkidle0" });
await sleep(500);
await A.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await A.click(".theme-system input");
await sleep(300);
check(
  (await themeOf()) === "brownstone",
  "follow system: dark OS picks the dark theme",
);
await A.click('.theme-card[data-theme="dusk"]');
await sleep(300);
check(
  (await themeOf()) === "dusk" && JSON.parse(await stored())?.dark === "dusk",
  "in system mode a card click sets that half of the pair",
);
await A.emulateMediaFeatures([
  { name: "prefers-color-scheme", value: "light" },
]);
await sleep(300);
check(
  (await themeOf()) === "daylight",
  "switching the OS to light flips to the light theme live",
);
await A.emulateMediaFeatures([]);

// Another browser is untouched: the choice is per client.
const B = await (await browser.createBrowserContext()).newPage();
await B.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(300);
check(
  (await B.evaluate(() => document.documentElement.dataset.theme)) ===
    "brownstone",
  "a different browser still starts on the default",
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

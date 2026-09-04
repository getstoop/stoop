// Link previews: a message with a URL gets an Open Graph card once the
// server has fetched the page — title, site, description, and the image
// served from our own origin. The page lives on a throwaway server this
// spec runs; the app server must allow private addresses for that
// (STOOP_UNFURL_ALLOW_PRIVATE=1, as CI and the dev setup do). Also: links
// inside code are not unfurled, and editing the link away drops the card.
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, png, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};

// The linked site.
const image = png(64, 32, (x) => (x < 32 ? [220, 80, 60] : [60, 120, 220]));
const site = createServer((req, res) => {
  if (req.url === "/img.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(image);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<html><head><title>fallback</title>
<meta property="og:title" content="Stoop &amp; friends">
<meta property="og:description" content="A self-hostable chat and voice app.">
<meta property="og:site_name" content="Example Site">
<meta property="og:image" content="/img.png">
</head><body>hello</body></html>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const siteUrl = `http://127.0.0.1:${site.address().port}`;

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
const path = (p) => new URL(p.url()).pathname;
const cardOf = async (index) => {
  const rows = await A.$$(".message");
  const row = rows[index];
  if (!row) return null;
  return A.evaluate((el) => {
    const c = el.querySelector(".link-preview");
    if (!c) return null;
    return {
      href: c.getAttribute("href"),
      site: c.querySelector(".link-preview-site")?.textContent ?? "",
      title: c.querySelector(".link-preview-title")?.textContent ?? "",
      description:
        c.querySelector(".link-preview-description")?.textContent ?? "",
      image: c.querySelector(".link-preview-image")?.getAttribute("src") ?? "",
    };
  }, row);
};
const waitForCard = async (index, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const c = await cardOf(index);
    if (c) return c;
    await sleep(250);
  }
  return null;
};

await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
await A.click("button.primary");
await sleep(1500);

// A message with a link gets a card, delivered live after the fetch.
await A.type(".composer textarea", `look at ${siteUrl}/page`);
await A.keyboard.press("Enter");
const card = await waitForCard(0);
check(card !== null, "a card appears for the link");
check(
  card?.href === `${siteUrl}/page` &&
    card?.title === "Stoop & friends" &&
    card?.site === "Example Site" &&
    card?.description === "A self-hostable chat and voice app.",
  `card carries the Open Graph metadata (${JSON.stringify(card)})`,
);
check(
  card?.image.startsWith("/files/"),
  `the image is served from our origin, not the linked site (${card?.image})`,
);
if (card?.image) {
  const status = await A.evaluate(
    async (src) => (await fetch(src)).status,
    card.image,
  );
  check(status === 200, "preview image downloads");
}

// Reload: the card comes from the list, not just the live event.
await A.reload({ waitUntil: "networkidle0" });
await sleep(800);
check((await cardOf(0))?.title === "Stoop & friends", "card survives a reload");

// A link inside code is left alone; a second message with the same link
// shows the cached card immediately.
await A.type(".composer textarea", `code: \`${siteUrl}/page\``);
await A.keyboard.press("Enter");
await sleep(1500);
check((await cardOf(1)) === null, "links in code spans are not unfurled");
await A.type(".composer textarea", `same link ${siteUrl}/page`);
await A.keyboard.press("Enter");
await sleep(800);
check(
  (await cardOf(2))?.title === "Stoop & friends",
  "cached preview appears on the next message",
);

// Editing the link out of a message drops the card.
const rows = await A.$$(".message");
await rows[2].hover();
for (const b of await rows[2].$$(".message-action")) {
  if (
    (await A.evaluate((e) => e.title, b)) === "Edit" &&
    (await b.boundingBox())
  ) {
    await b.click();
    break;
  }
}
await sleep(300);
await A.click(".message-editor textarea", { count: 3 });
await A.keyboard.press("Backspace");
await A.type(".message-editor textarea", "no link any more");
await A.keyboard.press("Enter");
await sleep(1000);
check((await cardOf(2)) === null, "editing the link away removes the card");

site.close();
await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

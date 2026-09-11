import { createServer } from "node:http";
import type { Page } from "@playwright/test";
import { expect, reload, say, seed, signIn, test } from "./lib";

// The og:image the throwaway site serves: a 64×32 PNG, red half, blue half.
const IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAO0lEQVR4nO3PQREAAAQAMMGEEEdYYWTw8NvdCiym8lX2vAoBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgasFe3jgpkxM03cAAAAASUVORK5CYII=",
  "base64",
);

// Link previews: a message with a URL gets an Open Graph card once the
// server has fetched the page — title, site, description, and the image
// served from our own origin. The page lives on a throwaway server this
// spec runs; the app server must allow private addresses for that
// (STOOP_UNFURL_ALLOW_PRIVATE=1, as CI and the dev setup do). Also: links
// inside code are not unfurled, and editing the link away drops the card.
// Ported from web/e2e/unfurl.mjs (STOOP-238).
test("open graph cards for links", async ({ browser }) => {
  // The linked site.
  const site = createServer((req, res) => {
    if (req.url === "/img.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(IMAGE);
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
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  const port = (site.address() as { port: number }).port;
  const siteUrl = `http://127.0.0.1:${port}`;

  try {
    const { tokens } = await seed({ users: ["ada"] });
    const A = await (await browser.newContext()).newPage();
    const card = (p: Page, index: number) =>
      p.locator(".message").nth(index).locator(".link-preview");

    await signIn(A, tokens.ada);

    // A message with a link gets a card, delivered live after the fetch.
    await say(A, `look at ${siteUrl}/page`);
    await expect(card(A, 0), "a card appears for the link").toBeVisible();
    await expect(
      card(A, 0),
      "the card links where the message did",
    ).toHaveAttribute("href", `${siteUrl}/page`);
    await expect(
      card(A, 0).locator(".link-preview-title"),
      "card carries the Open Graph title",
    ).toHaveText("Stoop & friends");
    await expect(
      card(A, 0).locator(".link-preview-site"),
      "card carries the site name",
    ).toHaveText("Example Site");
    await expect(
      card(A, 0).locator(".link-preview-description"),
      "card carries the description",
    ).toHaveText("A self-hostable chat and voice app.");
    const image0 = card(A, 0).locator(".link-preview-image");
    await expect(
      image0,
      "the image is served from our origin, not the linked site",
    ).toHaveAttribute("src", /^\/files\//);
    const src = (await image0.getAttribute("src")) ?? "";
    expect(
      await A.evaluate(async (s: string) => (await fetch(s)).status, src),
      "preview image downloads",
    ).toBe(200);

    // Reload: the card comes from the list, not just the live event.
    await reload(A);
    await expect(
      card(A, 0).locator(".link-preview-title"),
      "card survives a reload",
    ).toHaveText("Stoop & friends");

    // A link inside code is left alone; a second message with the same link
    // shows the cached card immediately. The cached card lands after the
    // code span's would have, so it is what proves the absence below.
    await say(A, `code: \`${siteUrl}/page\``);
    await A.locator(".message").nth(1).waitFor();
    await say(A, `same link ${siteUrl}/page`);
    await expect(
      card(A, 2).locator(".link-preview-title"),
      "cached preview appears on the next message",
    ).toHaveText("Stoop & friends");
    await expect(
      card(A, 1),
      "links in code spans are not unfurled",
    ).toHaveCount(0);

    // Editing the link out of a message drops the card.
    const third = A.locator(".message").nth(2);
    await third.hover();
    await third.locator('.message-action[aria-label="Edit"]').click();
    await A.locator(".message-editor textarea").fill("no link any more");
    await A.keyboard.press("Enter");
    await expect(
      card(A, 2),
      "editing the link away removes the card",
    ).toHaveCount(0);
  } finally {
    site.close();
  }
});

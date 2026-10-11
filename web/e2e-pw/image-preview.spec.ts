import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, seed, signIn, test } from "./lib";
import { png } from "./png";

// The image preview: a click on an image in chat opens it over a scrim in
// the app, not in a new window. Its size, the ways out, the download and
// the steps to the images around it. What this can't see is the scrim's
// darkness and the cursor.
test("image preview: opening, sizing, stepping and closing", async ({
  browser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "stoop-preview-"));
  const file = (name: string) => join(dir, name);
  writeFileSync(
    file("small.png"),
    png(320, 200, (x, y) => [x % 256, y % 256, 120]),
  );
  // Larger than the window in both directions.
  writeFileSync(
    file("large.png"),
    png(2400, 1800, (x, y) => [x % 256, y % 256, 200]),
  );
  writeFileSync(
    file("last.png"),
    png(200, 320, (x, y) => [y % 256, x % 256, 40]),
  );
  writeFileSync(file("notes.txt"), "meeting notes\n");

  const { tokens } = await seed({ channels: ["general"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await signIn(page, tokens.ada);
  await expect(page.locator(".composer textarea")).toBeVisible();

  const thumbnails = page.locator(".attachment-image > button");
  const send = async (...names: string[]) => {
    await page
      .locator('.composer input[type="file"]')
      .setInputFiles(names.map(file));
    await expect(page.locator(".attachment-strip .pending.ready")).toHaveCount(
      names.length,
    );
    await page.locator(".composer textarea").click();
    await page.keyboard.press("Enter");
    await expect(page.locator(".attachment-strip .pending")).toHaveCount(0);
  };
  // Each lands before the next is sent, so their order is the send order.
  await send("small.png");
  await expect(thumbnails).toHaveCount(1);
  await send("notes.txt", "large.png");
  await expect(thumbnails).toHaveCount(2);
  await send("last.png");
  await expect(thumbnails).toHaveCount(3);

  const preview = page.locator(".image-preview");
  const image = preview.locator("img");
  const previous = preview.locator('button[aria-label="Previous image"]');
  const next = preview.locator('button[aria-label="Next image"]');
  const download = preview.locator(".image-preview-download");
  // Where the image sits, once it has decoded.
  const box = async (naturalWidth: number) => {
    await expect
      .poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBe(naturalWidth);
    return image.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        width: Math.round(r.width),
        height: Math.round(r.height),
        centreX: Math.round(r.left + r.width / 2),
        centreY: Math.round(r.top + r.height / 2),
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
      };
    });
  };

  // --- opens in the app, at the image's own size, centred
  await thumbnails.nth(0).click();
  await expect(preview, "a click opens the preview").toBeVisible();
  expect(context.pages(), "no new window or tab opens").toHaveLength(1);
  await expect(image).toHaveAttribute("alt", "small.png");
  const small = await box(320);
  expect(
    [small.width, small.height, small.centreX, small.centreY],
    "a small image shows at its own size, centred in the window",
  ).toEqual([320, 200, 640, 400]);
  await expect(previous, "no older image, no previous arrow").toHaveCount(0);
  await expect(next).toHaveCount(1);

  // --- download: the file, under its name, with the preview left open
  await expect(download).toHaveText("Download");
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  expect(saved.suggestedFilename(), "downloads under the file's name").toBe(
    "small.png",
  );
  await expect(preview, "downloading leaves the preview open").toHaveCount(1);

  // --- next: the text file between the images is passed over
  await next.click();
  await expect(image, "next skips a file that is not an image").toHaveAttribute(
    "alt",
    "large.png",
  );
  const large = await box(2400);
  expect(
    large.width < 2400 &&
      large.top >= 0 &&
      large.left >= 0 &&
      large.right <= 1280 &&
      large.bottom <= 800,
    `a large image is shrunk to fit the window (${JSON.stringify(large)})`,
  ).toBe(true);
  expect(
    Math.abs(large.width / large.height - 2400 / 1800) < 0.01,
    "and keeps its proportions",
  ).toBe(true);
  await expect(download, "download follows the image shown").toHaveAttribute(
    "download",
    "large.png",
  );
  const gaps = await preview.evaluate((e) => {
    const rect = (selector: string) =>
      (e.querySelector(selector) as Element).getBoundingClientRect();
    const shown = rect("img");
    return [
      Math.round(shown.left - rect('[aria-label="Previous image"]').right),
      Math.round(rect('[aria-label="Next image"]').left - shown.right),
    ];
  });
  expect(gaps, "the arrows sit just outside the image's edges").toEqual([
    12, 12,
  ]);

  // --- arrow keys step too, and stop at each end
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("alt", "last.png");
  await expect(next, "no newer image, no next arrow").toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(image, "the last image stays at the end").toHaveAttribute(
    "alt",
    "last.png",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(image).toHaveAttribute("alt", "large.png");
  await previous.click();
  await expect(image).toHaveAttribute("alt", "small.png");

  // --- three ways out
  await page.keyboard.press("Escape");
  await expect(preview, "Escape closes the preview").toHaveCount(0);
  await expect(
    thumbnails.nth(0),
    "focus returns to the image that opened it",
  ).toBeFocused();

  await thumbnails.nth(1).click();
  await expect(image).toHaveAttribute("alt", "large.png");
  await image.click();
  await expect(preview, "a click on the image keeps it open").toHaveCount(1);
  await page.mouse.click(640, 790);
  await expect(preview, "a click on the scrim closes it").toHaveCount(0);

  await thumbnails.nth(2).click();
  await preview.locator('button[aria-label="Close"]').click();
  await expect(preview, "the close button closes it").toHaveCount(0);

  await context.close();
  rmSync(dir, { recursive: true, force: true });
});

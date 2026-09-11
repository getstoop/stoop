import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, seed, signIn, test } from "./lib";
import { png } from "./png";

// File uploads, phase 1: avatars and space icons. Besides what the UI
// shows, this spec measures two things the UI can't: the served image's
// real pixel size, and the blob on disk before and after a replacement
// (the data dir is STOOP_STORAGE_DIR, resolved against the repo root the
// server runs from).
// Ported from web/e2e/uploads.mjs (STOOP-238).

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(
  join(here, "..", ".."),
  process.env.STOOP_STORAGE_DIR ?? "./data",
);

// A minimal PNG encoder (RGB, no filter) so the spec makes its own images
// without fixtures. pixel(x, y) returns [r, g, b].

test("avatars and space icons", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "stoop-uploads-"));
  const files = {
    red: join(dir, "red.png"),
    blue: join(dir, "blue.png"),
    icon: join(dir, "icon.png"),
    notPng: join(dir, "notes.png"),
    huge: join(dir, "huge.png"),
  };
  writeFileSync(
    files.red,
    png(300, 200, () => [220, 40, 40]),
  );
  writeFileSync(
    files.blue,
    png(120, 120, () => [40, 60, 220]),
  );
  writeFileSync(
    files.icon,
    png(64, 64, (x: number, y: number) => [x * 4, y * 4, 90]),
  );
  writeFileSync(files.notPng, "this is a text file wearing a .png extension\n");
  // Random pixels don't compress: 950×950 RGB noise is well over 2 MB.
  writeFileSync(
    files.huge,
    png(950, 950, () => [
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
    ]),
  );

  try {
    const { suffix, tokens, space } = await seed();
    const fetchStatus = (page: Page, path: string) =>
      page.evaluate(async (p: string) => {
        // The server marks files immutable, so bypass the browser cache to
        // observe the current status of a replaced id.
        const r = await fetch(p, { cache: "no-store" });
        return {
          status: r.status,
          type: r.headers.get("content-type"),
          nosniff: r.headers.get("x-content-type-options"),
          cache: r.headers.get("cache-control"),
          disposition: r.headers.get("content-disposition"),
        };
      }, path);
    const pick = (page: Page, path: string) =>
      page.locator('input[type="file"]').setInputFiles(path);

    // A owns the space; B is a member.
    const A = await (await browser.newContext()).newPage();
    await signIn(A, tokens.ada);
    const B = await (await browser.newContext()).newPage();
    await signIn(B, tokens.bea);
    await B.locator(".composer textarea").waitFor();

    // --- avatar: rejects first, then a real upload
    await A.goto("/profile");
    const avatar = A.locator(".profile-header .avatar[data-file-id]");
    const uploadError = A.locator(".upload-error");
    await A.locator(".profile-header .avatar").waitFor();
    await expect(
      avatar,
      "profile shows initials before any upload",
    ).toHaveCount(0);

    await pick(A, files.huge);
    await expect(
      uploadError,
      "oversize file rejected with a visible error",
    ).toContainText("2 MB");
    await expect(avatar, "oversize file did not become the avatar").toHaveCount(
      0,
    );
    await pick(A, files.notPng);
    await expect(
      uploadError,
      ".txt renamed .png rejected by the server",
    ).toContainText("not a supported image");

    // The server cap is enforced independently of the client check.
    const serverCap = await A.evaluate(async () => {
      const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await fetch("/stoop.files.v1.FileService/UploadAvatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: btoa(s) }),
      });
      return { status: r.status, body: await r.json() };
    });
    expect(
      serverCap.status,
      "server rejects an oversize upload on its own",
    ).toBe(400);
    expect(serverCap.body.code, "…as invalid_argument").toBe(
      "invalid_argument",
    );

    await pick(A, files.red);
    await expect(avatar, "avatar uploaded").toBeVisible();
    const firstId = (await avatar.getAttribute("data-file-id")) ?? "";
    await expect(
      A.locator(".space-pill.avatar .avatar[data-file-id]"),
      "rail pill shows the avatar",
    ).toBeVisible();
    await expect
      .poll(() => existsSync(join(dataDir, "avatar", firstId)), {
        message: `blob is in the data dir (${join("avatar", firstId)})`,
      })
      .toBe(true);
    const served = await fetchStatus(A, `/files/${firstId}`);
    expect(served.status, "GET /files/{id} is 200").toBe(200);
    expect(served.type, "…with the image's content type").toBe("image/png");
    expect(served.nosniff, "…and nosniff").toBe("nosniff");
    expect(served.cache, "…cached immutably").toContain("immutable");
    expect(served.disposition, "…served inline").toBe("inline");
    const dims = await A.evaluate(async (p: string) => {
      const bmp = await createImageBitmap(await (await fetch(p)).blob());
      return [bmp.width, bmp.height];
    }, `/files/${firstId}`);
    expect(dims, "served avatar is 256×256").toEqual([256, 256]);

    // B sees it live: members panel, and the user card.
    await expect(
      B.locator(".members-panel .avatar[data-file-id]"),
      "B's members panel shows A's avatar live",
    ).toBeVisible();
    await B.locator(".member-row", { hasText: `ada${suffix}` }).click();
    await expect(
      B.locator(".user-card .avatar[data-file-id]"),
      "user card shows the avatar",
    ).toHaveAttribute("data-file-id", firstId);
    await B.keyboard.press("Escape");
    await B.locator(".user-card").waitFor({ state: "detached" });

    // --- replace: new id, old blob gone, old id 404
    await pick(A, files.blue);
    await expect(avatar, "replacement got a new id").not.toHaveAttribute(
      "data-file-id",
      firstId,
    );
    const secondId = (await avatar.getAttribute("data-file-id")) ?? "";
    await expect
      .poll(() => existsSync(join(dataDir, "avatar", secondId)), {
        message: "new blob is in the data dir",
      })
      .toBe(true);
    await expect
      .poll(() => existsSync(join(dataDir, "avatar", firstId)), {
        message: "previous blob was deleted from the data dir",
      })
      .toBe(false);
    await expect
      .poll(async () => (await fetchStatus(A, `/files/${firstId}`)).status, {
        message: "previous id is 404",
      })
      .toBe(404);
    await expect(
      B.locator(".members-panel .avatar[data-file-id]"),
      "B's members panel switched to the new avatar live",
    ).toHaveAttribute("data-file-id", secondId);

    // --- space icon in a second space B is not a member of
    const second = await A.evaluate(async () => {
      const r = await fetch("/stoop.chat.v1.ChatService/CreateSpace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Private Club" }),
      });
      return (await r.json()).space.id;
    });
    await A.goto(`/s/${second}/settings`);
    const spaceIcon = A.locator(".space-settings-title [data-file-id]");
    await A.locator(".space-settings-title").waitFor();
    await expect(
      spaceIcon,
      "settings header shows initials before an icon is set",
    ).toHaveCount(0);
    await pick(A, files.icon);
    await spaceIcon.waitFor();
    const iconId = (await spaceIcon.getAttribute("data-file-id")) ?? "";
    await expect
      .poll(() => existsSync(join(dataDir, "space_icon", iconId)), {
        message: `icon blob is in the data dir (${join("space_icon", iconId)})`,
      })
      .toBe(true);
    await expect(
      A.locator(".space-rail-list .space-pill [data-file-id]"),
      "rail pill for the second space shows the icon",
    ).toHaveCount(1);
    const iconDims = await A.evaluate(async (p: string) => {
      const bmp = await createImageBitmap(await (await fetch(p)).blob());
      return [bmp.width, bmp.height];
    }, `/files/${iconId}`);
    expect(iconDims, "served icon is 512×512").toEqual([512, 512]);
    expect(
      (await fetchStatus(B, `/files/${iconId}`)).status,
      "GET /files/{id} for a space icon as a non-member is 403",
    ).toBe(403);
    expect(
      (await fetchStatus(B, `/files/${secondId}`)).status,
      "…while A's avatar is visible to B",
    ).toBe(200);
    const anon = await (await browser.newContext()).newPage();
    await anon.goto("/login");
    expect(
      (await fetchStatus(anon, `/files/${secondId}`)).status,
      "signed-out GET /files/{id} is 401",
    ).toBe(401);

    // A member of the shared space sees its icon live once one is set there.
    await A.goto(`/s/${space.id}/settings`);
    await A.locator(".space-settings-title").waitFor();
    await pick(A, files.icon);
    await spaceIcon.waitFor();
    await expect(
      B.locator(".space-rail-list .space-pill [data-file-id]"),
      "B's rail shows the shared space's new icon live",
    ).toBeVisible();
    await expect(
      B.locator(".sidebar-header .header-icon[data-file-id]"),
      "B's space header shows the icon",
    ).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

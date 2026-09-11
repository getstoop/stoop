import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { BASE } from "../e2e/seed.mjs";
import { acceptDialog, expect, seed, signIn, test } from "./lib";
import { png } from "./png";

// Attachments in messages (STOOP-42). The data dir check is a direct
// measurement the UI can't make: a deleted message's blobs must be gone.
// Ported from web/e2e/attachments.mjs (STOOP-238).

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(
  join(here, "..", ".."),
  process.env.STOOP_STORAGE_DIR ?? "./data",
);

// One byte over the server's cap (internal/files MaxAttachmentBytes).
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

test("attachments: sending, serving, capping and deleting", async ({
  browser,
}) => {
  // The oversize fixture alone is 100 MB to write and hand to the
  // browser, and the run ends with two pages' worth of uploads.
  test.setTimeout(120_000);

  const dir = mkdtempSync(join(tmpdir(), "stoop-attach-"));
  const files = {
    pic: join(dir, "pic.png"),
    notes: join(dir, "notes.txt"),
    svg: join(dir, "logo.svg"),
    huge: join(dir, "huge.bin"),
    many: Array.from({ length: 11 }, (_, i) => join(dir, `n${i}.txt`)),
  };
  writeFileSync(
    files.pic,
    png(320, 200, (x, y) => [x % 256, y % 256, 120]),
  );
  writeFileSync(files.notes, "meeting notes\n- bring snacks\n");
  writeFileSync(
    files.svg,
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(files.huge, randomBytes(MAX_ATTACHMENT_BYTES + 1024));
  for (const [i, p] of files.many.entries()) writeFileSync(p, `file ${i}\n`);

  const { tokens, channels } = await seed({ channels: ["general"] });
  const channelId = channels.general;

  const fileIdOf = (src: string) =>
    new URL(src, BASE).pathname.split("/").pop();
  // Fetched from inside the page so the session cookie rides along.
  const head = (page: Page, path: string) =>
    page.evaluate(async (p: string) => {
      const r = await fetch(p, { cache: "no-store" });
      return {
        status: r.status,
        type: r.headers.get("content-type"),
        disposition: r.headers.get("content-disposition"),
      };
    }, path);

  const attach = (page: Page, ...paths: string[]) =>
    page.locator('.composer input[type="file"]').setInputFiles(paths);
  const pendingReady = (page: Page) =>
    page.locator(".attachment-strip .pending.ready");

  // Continued rows render their actions twice (a hidden meta copy and the
  // hover gutter), so the label alone matches two elements and strict mode
  // refuses. Only one of them is laid out.
  const clickAction = async (p: Page, index: number, label: string) => {
    const row = p.locator(".message").nth(index);
    await row.hover();
    await row
      .locator(`.message-action[aria-label="${label}"]`)
      .filter({ visible: true })
      .first()
      .click();
  };

  // A and B are both members (seeded).
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await expect(A.locator(".composer textarea")).toBeVisible();
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

  // --- image, attachment-only message
  await expect(
    A.locator(".attach-button"),
    "composer has an attach button",
  ).toHaveCount(1);
  await attach(A, files.pic);
  await expect(pendingReady(A)).toBeVisible();
  await expect(
    A.locator(".attachment-strip .pending img.pending-thumb"),
    "pending strip shows an image thumbnail",
  ).toHaveCount(1);
  await A.locator(".composer textarea").click();
  await A.keyboard.press("Enter");
  await expect(
    A.locator(".message .attachments img"),
    "attachment-only message sent and renders the image inline",
  ).toBeVisible();
  await expect(
    A.locator(".attachment-strip"),
    "pending strip clears after send",
  ).toHaveCount(0);

  const bImage = B.locator(".message .attachments img");
  await expect(bImage, "B sees the image live").toBeVisible();
  const picId = fileIdOf(await bImage.evaluate((e: HTMLImageElement) => e.src));
  const picHead = await head(B, `/files/${picId}`);
  expect(
    picHead.status === 200 &&
      picHead.type === "image/png" &&
      picHead.disposition === "inline",
    `image served inline to a member (${JSON.stringify(picHead)})`,
  ).toBe(true);
  // The bytes are the ones that were sent, so the decoded size is the
  // size it was written at — but only once the image has decoded.
  await expect
    .poll(
      () =>
        bImage.evaluate((e: HTMLImageElement) => [
          e.naturalWidth,
          e.naturalHeight,
        ]),
      { message: "image is stored as sent, not re-encoded" },
    )
    .toEqual([320, 200]);

  const dl = await B.locator(".attachment-image .attachment-download").evaluate(
    (e: HTMLElement) => ({
      href: e.getAttribute("href"),
      download: e.getAttribute("download"),
      name: e.closest(".attachment-bar")?.querySelector(".attachment-name")
        ?.textContent,
    }),
  );
  expect(
    dl.href === `/files/${picId}` &&
      dl.download === "pic.png" &&
      dl.name === "pic.png",
    `inline image has a download link with its filename (${dl.download})`,
  ).toBe(true);

  // --- text file with a message: download card, attachment disposition
  await attach(A, files.notes);
  await expect(pendingReady(A)).toBeVisible();
  await A.locator(".composer textarea").pressSequentially("notes from today");
  await A.keyboard.press("Enter");
  const bCard = B.locator(".attachment-card").first();
  await expect(bCard).toBeVisible();
  const card = await bCard.evaluate((e: HTMLElement) => ({
    text: e.innerText,
    href: e.getAttribute("href"),
    download: e.getAttribute("download"),
  }));
  expect(
    card.text.includes("notes.txt") && /\d+ B/.test(card.text),
    `download card shows name and size (${card.text.replace(/\n/g, " ")})`,
  ).toBe(true);
  expect(card.download, "card is a download link").toBe("notes.txt");
  const notesId = fileIdOf(card.href ?? "");
  const notesHead = await head(B, `/files/${notesId}`);
  expect(
    notesHead.status === 200 &&
      notesHead.type?.startsWith("text/plain") &&
      notesHead.disposition?.startsWith("attachment"),
    `text file served as an attachment (${JSON.stringify(notesHead)})`,
  ).toBe(true);
  await expect(
    B.locator(".message-content", { hasText: "notes from today" }),
    "message text renders alongside the attachment",
  ).toHaveCount(1);

  // --- SVG never renders inline
  await attach(A, files.svg);
  await expect(pendingReady(A)).toBeVisible();
  await A.keyboard.press("Enter");
  await expect(
    A.locator(".attachment-card"),
    "an .svg becomes a download card, not an inline image",
  ).toHaveCount(2);
  await expect(
    A.locator(".attachments img"),
    "…and not a second image",
  ).toHaveCount(1);
  const cards = await A.locator(".attachment-card").evaluateAll(
    (els: HTMLElement[]) => els.map((e) => e.getAttribute("href")),
  );
  const svgHead = await head(A, cards[1] ?? "");
  expect(
    svgHead.disposition?.startsWith("attachment") &&
      !svgHead.type?.startsWith("image/svg"),
    `svg served as an attachment (${JSON.stringify(svgHead)})`,
  ).toBe(true);

  // --- drag and drop onto the composer
  await A.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["dropped bytes"], "dropped.txt", { type: "text/plain" }),
    );
    const target = document.querySelector(".composer");
    target?.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, dataTransfer: dt }),
    );
    target?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
    );
  });
  await expect(pendingReady(A)).toBeVisible();
  await expect(
    A.locator(".attachment-strip .pending-name"),
    "dropping a file onto the composer attaches it",
  ).toHaveText("dropped.txt");
  await A.locator(".pending-remove").click();
  await expect(
    A.locator(".attachment-strip"),
    "removing a pending file clears the strip",
  ).toHaveCount(0);

  // --- rejections: oversize (client and server), too many
  await attach(A, files.huge);
  await expect(
    A.locator(".pending.failed .pending-meta"),
    "oversize file rejected with a visible error",
  ).toContainText("100 MB");
  await A.locator(".pending-remove").click();
  const serverCap = await A.evaluate(
    async ([chId, max]: [string, number]) => {
      const form = new FormData();
      form.append("channel_id", chId);
      form.append("file", new Blob([new Uint8Array(max + 1)]), "big.bin");
      const r = await fetch("/files/upload", { method: "POST", body: form });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    [channelId, MAX_ATTACHMENT_BYTES] as [string, number],
  );
  expect(
    serverCap.status === 413 && serverCap.body.error?.includes("100 MB"),
    `server enforces the cap on its own (${serverCap.status} ${serverCap.body.error})`,
  ).toBe(true);

  await attach(A, ...files.many);
  await expect(
    A.locator(".attachment-error"),
    "an 11th file is refused with a visible error",
  ).toContainText("10");
  await expect(
    A.locator(".attachment-strip .pending"),
    "ten files are held",
  ).toHaveCount(10);
  // Clear them without sending. dispatchEvent, not click: the remove
  // button sits behind the file-name label, so a real click never reaches
  // it — the original went straight to the handler too. One at a time,
  // because ten handlers in a single evaluate lose most of their effect
  // to React re-rendering underneath them.
  const removes = A.locator(".pending-remove");
  for (let n = await removes.count(); n > 0; n = await removes.count())
    await removes.first().dispatchEvent("click");
  // The strip itself stays: it is still holding the "only 10" error.
  await expect(A.locator(".attachment-strip .pending")).toHaveCount(0);

  // --- a pending upload can't be claimed by someone else, or twice
  const pendingId = await A.evaluate(async (chId: string) => {
    const form = new FormData();
    form.append("channel_id", chId);
    form.append("file", new Blob(["secret"]), "secret.txt");
    const r = await fetch("/files/upload", { method: "POST", body: form });
    return (await r.json()).id as string;
  }, channelId);

  const sendWith = (page: Page, ids: string[], content = "x") =>
    page.evaluate(
      async ([chId, attachmentIds, body]: [string, string[], string]) => {
        const r = await fetch("/stoop.chat.v1.ChatService/SendMessage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channelId: chId,
            content: body,
            attachmentIds,
          }),
        });
        return { status: r.status, body: await r.json() };
      },
      [channelId, ids, content] as [string, string[], string],
    );

  const forged = await sendWith(B, [pendingId]);
  expect(
    forged.status === 400 && forged.body.code === "invalid_argument",
    `B cannot claim A's pending upload (${forged.status} ${forged.body.message})`,
  ).toBe(true);
  const own = await sendWith(A, [pendingId], "");
  expect(own.status, "A claims it in an attachment-only message").toBe(200);
  const twice = await sendWith(A, [pendingId]);
  expect(
    twice.status === 400 && twice.body.message?.includes("already used"),
    `a file can't be attached to a second message (${twice.body.message})`,
  ).toBe(true);

  // --- reply quote of an attachment-only message previews the file name
  // B has to have the attachment-only message before "the last row" is it.
  await expect(B.locator(".message")).toHaveCount(
    await A.locator(".message").count(),
  );
  await clickAction(B, (await B.locator(".message").count()) - 1, "Reply");
  await expect(
    B.locator(".reply-bar"),
    "reply bar previews the attachment name",
  ).toContainText("📎 secret.txt");
  await B.locator(".composer textarea").pressSequentially("got it");
  await B.keyboard.press("Enter");
  await expect(
    A.locator(".reply-quote .reply-preview"),
    "reply quote shows the attachment preview",
  ).toHaveText("📎 secret.txt");

  // --- deleting a message deletes its blobs
  expect(
    existsSync(join(dataDir, "attachment", notesId ?? "")),
    "notes blob is in the data dir before deletion",
  ).toBe(true);
  await clickAction(A, 1, "Delete");
  await acceptDialog(A);
  await expect
    .poll(() => existsSync(join(dataDir, "attachment", notesId ?? "")), {
      message: "deleting the message removed its blob from the data dir",
    })
    .toBe(false);
  await expect
    .poll(async () => (await head(A, `/files/${notesId}`)).status, {
      message: "deleted attachment id is 404",
    })
    .toBe(404);
  await expect(
    B.locator(".attachment-card"),
    "B's view drops the deleted message's card",
  ).toHaveCount(2);

  // --- non-member can't fetch attachments in another space
  const other = await A.evaluate(async () => {
    const r = await fetch("/stoop.chat.v1.ChatService/CreateSpace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Private Club" }),
    });
    const { defaultChannel } = await r.json();
    const form = new FormData();
    form.append("channel_id", defaultChannel.id);
    form.append("file", new Blob(["members only"]), "private.txt");
    const up = await fetch("/files/upload", { method: "POST", body: form });
    const { id } = await up.json();
    await fetch("/stoop.chat.v1.ChatService/SendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId: defaultChannel.id,
        content: "",
        attachmentIds: [id],
      }),
    });
    return id as string;
  });
  expect(
    (await head(B, `/files/${other}`)).status,
    "non-member GET of another space's attachment is 403",
  ).toBe(403);
  expect(
    (await head(A, `/files/${other}`)).status,
    "…while the member can fetch it",
  ).toBe(200);

  rmSync(dir, { recursive: true, force: true });
});

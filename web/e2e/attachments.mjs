import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { acceptDialog, BASE as base, chromePath, png, sleep } from "./lib.mjs";

// Attachments in messages (STOOP-42). The data dir check is a direct
// measurement the UI can't make: a deleted message's blobs must be gone.

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(
  join(here, "..", ".."),
  process.env.STOOP_STORAGE_DIR ?? "./data",
);

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
// One byte over the server's cap (internal/files MaxAttachmentBytes).
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
writeFileSync(files.huge, randomBytes(MAX_ATTACHMENT_BYTES + 1024));
for (const [i, p] of files.many.entries()) writeFileSync(p, `file ${i}\n`);

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const suffix = String(Date.now() % 1000000);
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  p.on("dialog", (d) => d.accept());
  return p;
};
const fileIdOf = (src) => new URL(src, base).pathname.split("/").pop();
const head = (page, path) =>
  page.evaluate(async (p) => {
    const r = await fetch(p, { cache: "no-store" });
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      disposition: r.headers.get("content-disposition"),
    };
  }, path);
const attach = async (page, ...paths) => {
  const input = await page.$('.composer input[type="file"]');
  await input.uploadFile(...paths);
};
const clickAction = async (p, index, label) => {
  const rows = await p.$$(".message");
  await rows[index].hover();
  const btns = await rows[index].$$(".message-action");
  // Continued rows render their actions twice (hidden meta + hover
  // gutter); click the one that is actually laid out.
  for (const b of btns)
    if ((await p.evaluate((e) => e.title, b)) === label) {
      if (await b.boundingBox()) {
        await b.click();
        return;
      }
    }
  throw new Error(`no ${label} on message ${index}`);
};

// A sets up; B joins.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
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
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1200);
const channelId = new URL(A.url()).pathname.split("/")[4];
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);

// --- image, attachment-only message
check((await A.$(".attach-button")) !== null, "composer has an attach button");
await attach(A, files.pic);
await A.waitForSelector(".attachment-strip .pending.ready", { timeout: 5000 });
check(
  (await A.$(".attachment-strip .pending img.pending-thumb")) !== null,
  "pending strip shows an image thumbnail",
);
await A.click(".composer textarea");
await A.keyboard.press("Enter");
await A.waitForSelector(".message .attachments img", { timeout: 5000 });
check(true, "attachment-only message sent and renders the image inline");
check(
  (await A.$(".attachment-strip")) === null,
  "pending strip clears after send",
);
await B.waitForSelector(".message .attachments img", { timeout: 5000 });
const picId = fileIdOf(
  await B.$eval(".message .attachments img", (e) => e.src),
);
check(true, "B sees the image live");
const picHead = await head(B, `/files/${picId}`);
check(
  picHead.status === 200 &&
    picHead.type === "image/png" &&
    picHead.disposition === "inline",
  `image served inline to a member (${JSON.stringify(picHead)})`,
);
const natural = await B.$eval(".message .attachments img", (e) => [
  e.naturalWidth,
  e.naturalHeight,
]);
check(
  natural[0] === 320 && natural[1] === 200,
  `image is stored as sent, not re-encoded (${natural.join("×")})`,
);
const dl = await B.$eval(".attachment-image .attachment-download", (e) => ({
  href: e.getAttribute("href"),
  download: e.getAttribute("download"),
  name: e.closest(".attachment-bar").querySelector(".attachment-name")
    .textContent,
}));
check(
  dl.href === `/files/${picId}` &&
    dl.download === "pic.png" &&
    dl.name === "pic.png",
  `inline image has a download link with its filename (${dl.download})`,
);

// --- text file with a message: download card, attachment disposition
await attach(A, files.notes);
await A.waitForSelector(".attachment-strip .pending.ready", { timeout: 5000 });
await A.type(".composer textarea", "notes from today");
await A.keyboard.press("Enter");
await B.waitForSelector(".attachment-card", { timeout: 5000 });
const card = await B.$eval(".attachment-card", (e) => ({
  text: e.innerText,
  href: e.getAttribute("href"),
  download: e.getAttribute("download"),
}));
check(
  card.text.includes("notes.txt") && /\d+ B/.test(card.text),
  `download card shows name and size (${card.text.replace(/\n/g, " ")})`,
);
check(card.download === "notes.txt", "card is a download link");
const notesId = fileIdOf(card.href);
const notesHead = await head(B, `/files/${notesId}`);
check(
  notesHead.status === 200 &&
    notesHead.type?.startsWith("text/plain") &&
    notesHead.disposition?.startsWith("attachment"),
  `text file served as an attachment (${JSON.stringify(notesHead)})`,
);
check(
  (
    await B.$$eval(".message-content", (els) => els.map((e) => e.innerText))
  ).some((t) => t.includes("notes from today")),
  "message text renders alongside the attachment",
);

// --- SVG never renders inline
await attach(A, files.svg);
await A.waitForSelector(".attachment-strip .pending.ready", { timeout: 5000 });
await A.keyboard.press("Enter");
await sleep(1200);
const cards = await A.$$eval(".attachment-card", (els) =>
  els.map((e) => e.getAttribute("href")),
);
check(
  cards.length === 2 &&
    (await A.$$eval(".attachments img", (els) => els.length)) === 1,
  "an .svg becomes a download card, not an inline image",
);
const svgHead = await head(A, cards[1]);
check(
  svgHead.disposition?.startsWith("attachment") &&
    !svgHead.type?.startsWith("image/svg"),
  `svg served as an attachment (${JSON.stringify(svgHead)})`,
);

// --- drag and drop onto the composer
await A.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(
    new File(["dropped bytes"], "dropped.txt", { type: "text/plain" }),
  );
  const target = document.querySelector(".composer");
  target.dispatchEvent(
    new DragEvent("dragover", { bubbles: true, dataTransfer: dt }),
  );
  target.dispatchEvent(
    new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
  );
});
await A.waitForSelector(".attachment-strip .pending.ready", { timeout: 5000 });
check(
  (await A.$eval(".attachment-strip .pending-name", (e) => e.textContent)) ===
    "dropped.txt",
  "dropping a file onto the composer attaches it",
);
await A.click(".pending-remove");
await sleep(200);
check(
  (await A.$(".attachment-strip")) === null,
  "removing a pending file clears the strip",
);

// --- rejections: oversize (client and server), too many
await attach(A, files.huge);
await sleep(500);
const failed = await A.$eval(
  ".pending.failed .pending-meta",
  (e) => e.textContent,
).catch(() => null);
check(
  failed?.includes("100 MB"),
  `oversize file rejected with a visible error (${failed})`,
);
await A.click(".pending-remove");
const serverCap = await A.evaluate(
  async (chId, max) => {
    const form = new FormData();
    form.append("channel_id", chId);
    form.append("file", new Blob([new Uint8Array(max + 1)]), "big.bin");
    const r = await fetch("/files/upload", { method: "POST", body: form });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  channelId,
  MAX_ATTACHMENT_BYTES,
);
check(
  serverCap.status === 413 && serverCap.body.error?.includes("100 MB"),
  `server enforces the cap on its own (${serverCap.status} ${serverCap.body.error})`,
);
await attach(A, ...files.many);
await sleep(1500);
check(
  (
    await A.$eval(".attachment-error", (e) => e.textContent).catch(() => "")
  ).includes("10"),
  "an 11th file is refused with a visible error",
);
check(
  (await A.$$eval(".attachment-strip .pending", (els) => els.length)) === 10,
  "ten files are held",
);
// Clear them without sending.
await A.evaluate(() => {
  for (const b of document.querySelectorAll(".pending-remove")) b.click();
});
await sleep(300);

// --- a pending upload can't be claimed by someone else, or twice
const pendingId = await A.evaluate(async (chId) => {
  const form = new FormData();
  form.append("channel_id", chId);
  form.append("file", new Blob(["secret"]), "secret.txt");
  const r = await fetch("/files/upload", { method: "POST", body: form });
  return (await r.json()).id;
}, channelId);
const sendWith = (page, ids, content = "x") =>
  page.evaluate(
    async (chId, ids, content) => {
      const r = await fetch("/stoop.chat.v1.ChatService/SendMessage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: chId, content, attachmentIds: ids }),
      });
      return { status: r.status, body: await r.json() };
    },
    channelId,
    ids,
    content,
  );
const forged = await sendWith(B, [pendingId]);
check(
  forged.status === 400 && forged.body.code === "invalid_argument",
  `B cannot claim A's pending upload (${forged.status} ${forged.body.message})`,
);
const own = await sendWith(A, [pendingId], "");
check(own.status === 200, "A claims it in an attachment-only message");
const twice = await sendWith(A, [pendingId]);
check(
  twice.status === 400 && twice.body.message?.includes("already used"),
  `a file can't be attached to a second message (${twice.body.message})`,
);

// --- reply quote of an attachment-only message previews the file name
await sleep(800);
const rowsB = await B.$$(".message");
await clickAction(B, rowsB.length - 1, "Reply");
await sleep(300);
check(
  (await B.$eval(".reply-bar", (e) => e.innerText)).includes("📎 secret.txt"),
  "reply bar previews the attachment name",
);
await B.type(".composer textarea", "got it");
await B.keyboard.press("Enter");
await A.waitForSelector(".reply-quote", { timeout: 5000 });
check(
  (await A.$eval(".reply-quote .reply-preview", (e) => e.textContent)) ===
    "📎 secret.txt",
  "reply quote shows the attachment preview",
);

// --- deleting a message deletes its blobs
check(
  existsSync(join(dataDir, "attachment", notesId)),
  "notes blob is in the data dir before deletion",
);
await clickAction(A, 1, "Delete");
await acceptDialog(A);
await sleep(1000);
check(
  !existsSync(join(dataDir, "attachment", notesId)),
  "deleting the message removed its blob from the data dir",
);
check(
  (await head(A, `/files/${notesId}`)).status === 404,
  "deleted attachment id is 404",
);
check(
  (await B.$$eval(".attachment-card", (els) => els.length)) === 2,
  "B's view drops the deleted message's card",
);

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
  return id;
});
check(
  (await head(B, `/files/${other}`)).status === 403,
  "non-member GET of another space's attachment is 403",
);
check(
  (await head(A, `/files/${other}`)).status === 200,
  "…while the member can fetch it",
);

await browser.close();
rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

// Voice channels end to end: create one, join by clicking it (which opens
// its view, muted), see each other in the sidebar (snapshot and live),
// the muted marker on the stage tile and the deafened sidebar flag,
// speaking rings from Chrome's fake microphone,
// disconnect, and the gateway dropping a participant whose tab closed. Needs the app configured for a running
// LiveKit server; run with STOOP_E2E_VOICE=1.
import puppeteer from "puppeteer-core";
import { acceptDialog, BASE as base, chromePath, sleep } from "./lib.mjs";

// The stage bar (StageBar) fades after a few idle seconds and is
// click-through while it is faded, so wake it with a move over the stage
// before pressing anything on it.
const stageClick = async (p, sel) => {
  await p.hover(".voice-stage");
  await sleep(150);
  await p.click(`.stage-bar ${sel}`);
};

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    // Screen share without a picker: Chrome hands over a fake "screen".
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  // The stage animates tile moves with Web Animations (useTileFlip), on a
  // 180ms window a spec would race. Record the calls instead, so "did it
  // animate" is a question with a definite answer.
  await p.evaluateOnNewDocument(() => {
    window.__flips = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, opts) {
      if (opts?.id === "tile-flip") window.__flips.push(this.dataset?.tileKey);
      return animate.call(this, frames, opts);
    };
  });
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  return p;
};
const suffix = String(Date.now() % 1000000);
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const path = (p) => new URL(p.url()).pathname;
// Names listed under the voice channel, with their flags.
const participants = (p) =>
  p.$$eval(".voice-participant", (els) =>
    els.map((e) => ({
      name: e.querySelector(".member-name").textContent,
      flag: e.querySelector(".voice-flag")?.title ?? "",
      speaking: e.classList.contains("speaking"),
    })),
  );
// Poll until pred(participants) holds or the timeout passes.
const waitForParticipants = async (p, pred, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const list = await participants(p);
    if (pred(list)) return list;
    await sleep(200);
  }
  return participants(p);
};
// Tiles the stage animated since the last reset, and the geometry the
// packing produced.
const flips = (p) => p.evaluate(() => window.__flips.length);
const resetFlips = (p) =>
  p.evaluate(() => {
    window.__flips.length = 0;
  });
const stageGeometry = (p) =>
  p.evaluate(() => {
    const strip = document.querySelector(".stage-tiles");
    const box = strip.getBoundingClientRect();
    const tiles = [...strip.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.dataset.tileKey, x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return { box: { w: box.width, h: box.height }, tiles };
  });
// Would a uniform tile of this width fit the strip, at the row break
// flex-wrap would choose? Used to check the packing leaves no room.
const wouldFit = (w, box, n, gap = 8) => {
  const perRow = Math.max(1, Math.min(n, Math.floor((box.w - gap) / (w + gap))));
  const rows = Math.ceil(n / perRow);
  return (
    perRow * w + gap * (perRow + 1) <= box.w + 0.5 &&
    rows * ((w * 9) / 16) + gap * (rows + 1) <= box.h + 0.5
  );
};
// Muted shows on the stage tile now, not in the sidebar. Tiles are found
// by the name on the plate, which works for avatar and camera tiles alike.
const tileMuted = (page, name) =>
  page.evaluate((want) => {
    const tiles = [...document.querySelectorAll(".stage-tiles .stage-tile")];
    const tile = tiles.find(
      (el) => el.querySelector(".tile-label")?.textContent === want,
    );
    return tile ? tile.querySelector(".tile-muted") !== null : null;
  }, name);
const waitForTileMuted = async (page, name, want, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await tileMuted(page, name)) === want) return true;
    await sleep(150);
  }
  return false;
};
const barStatus = (p) => text(p, ".voice-bar strong");
const waitForBar = async (p, want, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await barStatus(p)) === want) return true;
    await sleep(200);
  }
  console.log(`  (voice bar says "${await barStatus(p)}")`);
  return false;
};
const ada = `ada${suffix}`;
const bea = `bea${suffix}`;

const A = await newPage("A");
A.on("dialog", (d) => d.accept("lounge"));
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', ada);
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
await sleep(1000);

// Create a voice channel from the sidebar (the prompt is answered "lounge").
await A.click(".channel-add.voice");
await acceptDialog(A, "lounge");
await A.waitForSelector(".voice-channel", { timeout: 5000 });
check(
  (await text(A, ".voice-channel .channel-name")) === "lounge",
  "voice channel created from the sidebar",
);
check((await A.$$(".voice-participant")).length === 0, "nobody in it yet");

// B joins the space and sees the empty voice channel.
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', bea);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

// A joins by clicking the channel: that opens its view, and the stage
// says "Connecting…" until the media path is up.
const sawConnecting = (async () => {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await A.$(".voice-stage.connecting")) return true;
    if ((await barStatus(A)) === "Voice connected") return false;
    await sleep(50);
  }
  return false;
})();
await A.click(".voice-channel .channel-link.voice");
check(await sawConnecting, "the stage shows Connecting… while joining");
check(await waitForBar(A, "Voice connected"), "A connects to voice");
check(
  (await A.$(".channel-link.voice.connected")) !== null,
  "A's channel row shows connected",
);
const voiceId = await A.$eval(".voice-channel", (e) => e.dataset.channelId);
check(
  path(A).endsWith(`/c/${voiceId}`),
  `clicking the row opened its view (${path(A)})`,
);
let list = await waitForParticipants(A, (l) => l.length === 1);
check(
  list.length === 1 && list[0].name === ada,
  "A is listed under the channel on their own screen",
);
list = await waitForParticipants(B, (l) => l.length === 1);
check(
  list.length === 1 && list[0].name === ada && list[0].flag === "",
  "B sees A in the channel, with no mute flag in the sidebar",
);
check(
  await waitForTileMuted(A, ada, true),
  "A joined muted, and their own tile says so",
);
check(
  (await A.$eval('.voice-bar [aria-label="Unmute"]', (e) => e.ariaPressed)) ===
    "true",
  "A's mic is muted on arrival",
);
check(
  (await A.$eval(
    '.voice-bar button[aria-label="Turn camera on"]',
    (e) => e.ariaPressed,
  )) === "false",
  "…and the camera is off",
);

// A late arrival gets the snapshot: B reloads and still sees A.
await B.reload({ waitUntil: "networkidle0" });
await sleep(800);
list = await waitForParticipants(B, (l) => l.length === 1);
check(list.length === 1 && list[0].name === ada, "Ready snapshot lists A");

// B joins too; both see two; B's bar is up.
await B.click(".voice-channel .channel-link.voice");
check(await waitForBar(B, "Voice connected"), "B connects to voice");
list = await waitForParticipants(A, (l) => l.length === 2);
check(
  list
    .map((p) => p.name)
    .sort()
    .join() === [bea, ada].sort().join(),
  "A sees both participants",
);
check(
  (await text(B, ".channel-header .join-voice")) === "Connected",
  "header chip shows Connected",
);

// Both arrived muted (the mic is published muted at join); unmuting is
// what starts carrying audio.
await A.click('.voice-bar [aria-label="Unmute"]');
await B.click('.voice-bar [aria-label="Unmute"]');
check(
  (await waitForTileMuted(B, ada, false)) && (await waitForTileMuted(B, bea, false)),
  "unmuting clears the marker on both tiles",
);

// Speaking rings: Chrome's fake microphone produces a tone, so each side
// should see the other light up within a few seconds.
list = await waitForParticipants(
  A,
  (l) => l.some((p) => p.name === bea && p.speaking),
  10000,
);
check(
  list.some((p) => p.name === bea && p.speaking),
  "A sees B speaking (ring)",
);

// Mute propagates to the tile; deafen is still a sidebar flag.
await A.click('.voice-bar [aria-label="Mute"]');
check(await waitForTileMuted(B, ada, true), "B sees A's tile marked muted");
check(
  (await participants(B)).every((p) => p.flag === ""),
  "…and the sidebar stays clear of it",
);
await A.click('.voice-bar [aria-label="Unmute"]');
check(await waitForTileMuted(B, ada, false), "B sees the marker clear");
await A.click('.voice-bar [aria-label="Deafen"]');
list = await waitForParticipants(B, (l) =>
  l.some((p) => p.name === ada && p.flag === "Deafened"),
);
check(
  list.some((p) => p.name === ada && p.flag === "Deafened"),
  "B sees A deafened",
);
check(
  (await A.$eval('.voice-bar [aria-label="Unmute"]', (e) => e.ariaPressed)) ===
    "true",
  "deafen also muted A",
);
check(
  await waitForTileMuted(B, ada, true),
  "…so A's tile carries the muted marker too",
);
await A.click('.voice-bar [aria-label="Unmute"]');
list = await waitForParticipants(B, (l) =>
  l.some((p) => p.name === ada && p.flag === ""),
);
check(
  list.some((p) => p.name === ada && p.flag === ""),
  "unmuting while deafened clears both",
);
check(await waitForTileMuted(B, ada, false), "…including the tile marker");

// Video (STOOP-74): the stage sits above the voice channel's chat — both
// sides are already on that view, since joining opened it; a camera makes
// a tile on the other side and a sidebar flag; a screen share takes the
// spotlight; turning them off clears both.
await sleep(800);
check(
  (await A.$(".voice-stage")) !== null &&
    (await A.$$(".stage-tile")).length === 2,
  "the stage shows above the chat with a tile per participant",
);
// Tiles fill the stage: two people, each tile wider than the 160px strip
// default (at puppeteer's 800px window that's ~230px).
check(
  (await A.$eval(".stage-tile", (e) => e.getBoundingClientRect().width)) > 200,
  "tiles size to the stage, not a fixed strip",
);

// Packing: the grid is sized by whichever axis runs out first, so two
// people sit side by side at the largest size the strip can hold.
const geo = await stageGeometry(A);
check(
  geo.tiles.length === 2 && geo.tiles.every((t) => t.key),
  "every tile wrapper carries its data-tile-key",
);
check(
  geo.tiles.length === 2 && Math.abs(geo.tiles[0].y - geo.tiles[1].y) < 1,
  `two people share a row (y ${geo.tiles.map((t) => Math.round(t.y)).join(" vs ")})`,
);
check(
  new Set(geo.tiles.map((t) => Math.round(t.w))).size === 1,
  "the tiles are all one size",
);
const tileW = Math.round(geo.tiles[0].w);
check(
  wouldFit(tileW, geo.box, geo.tiles.length),
  `the row fits the strip (${tileW}px in ${Math.round(geo.box.w)}x${Math.round(geo.box.h)})`,
);
check(
  !wouldFit(tileW + 8, geo.box, geo.tiles.length),
  `…and nothing larger would (${tileW + 8}px overflows)`,
);

// The stage animated when B arrived: A's own tile moved over to make
// room, and B's faded in.
check((await flips(A)) >= 2, `B's arrival animated A's tiles (${await flips(A)} flips)`);

// The divider drags.
const grip = await A.$eval(".stage-resizer", (e) => {
  const b = e.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
const stageBefore = await A.$eval(
  ".voice-stage",
  (e) => e.getBoundingClientRect().height,
);
await resetFlips(A);
await A.mouse.move(grip.x, grip.y);
await A.mouse.down();
await A.mouse.move(grip.x, grip.y + 120, { steps: 6 });
await A.mouse.up();
await sleep(300);
check(
  (await flips(A)) === 0,
  `dragging resizes the tiles without animating them (${await flips(A)} flips)`,
);
check(
  (await A.$eval(".voice-stage", (e) => e.getBoundingClientRect().height)) -
    stageBefore >
    80,
  "dragging the divider makes the stage taller",
);
await A.click('.voice-bar button[aria-label="Turn camera on"]');
await sleep(3000);
check(
  (await B.$$(".stage-tile.video")).length === 1,
  "B sees A's camera as a video tile",
);
check(
  (await B.$$eval(".voice-flag.live", (es) => es.map((e) => e.title))).includes(
    "Camera on",
  ),
  "B's sidebar flags A's camera",
);
// Pinning changes the tile set *and* the arrangement at once: the pinned
// camera leaves the grid for the spotlight, and the rest glide into the
// carousel rather than jumping there.
await resetFlips(B);
await B.click(".stage-tile.video");
await sleep(600);
check(
  (await B.$(".stage-spotlight")) !== null,
  "clicking a tile pins it to the spotlight",
);
check(
  (await flips(B)) > 0,
  `pinning animates the rest into the carousel (${await flips(B)} flips)`,
);
await resetFlips(B);
await B.click(".stage-tile.large");
await sleep(600);
check(
  (await B.$(".stage-spotlight")) === null,
  "clicking the spotlight unpins it",
);
check(
  (await flips(B)) > 0,
  `unpinning animates them back into the grid (${await flips(B)} flips)`,
);

// A share changes the arrangement without touching the tile set: the
// share goes straight to the spotlight, never the grid. That alone has
// to animate, or the two ways in would look different.
await resetFlips(B);
await A.click('.voice-bar button[aria-label="Share your screen"]');
await sleep(4000);
check(
  (await flips(B)) > 0,
  `a share starting animates the arrangement too (${await flips(B)} flips)`,
);
check(
  (await B.$(".stage-spotlight video")) !== null,
  "A's share takes B's spotlight",
);
check(
  (await B.$$eval(".voice-flag.live", (es) => es.map((e) => e.title))).includes(
    "Sharing their screen",
  ),
  "B's sidebar flags the share",
);

// The ring says who is talking, so it belongs to the person and not to
// what they are showing. A is unmuted with the fake tone playing, so
// over the next few seconds B should see A's own tile light up — and
// the share in the spotlight never.
let ringedTile = false;
let ringedShare = false;
for (let i = 0; i < 40; i++) {
  const seen = await B.evaluate(() => ({
    tile: !!document.querySelector(".stage-tiles .stage-tile.speaking"),
    share: !!document.querySelector(".stage-tile.large.speaking"),
  }));
  ringedTile ||= seen.tile;
  ringedShare ||= seen.share;
  if (ringedTile && ringedShare) break;
  await sleep(200);
}
check(ringedTile, "B sees A's own tile ring while A talks over a share");
check(!ringedShare, "…and the share in the spotlight never takes the ring");
await A.click('.voice-bar button[aria-label="Stop sharing"]');
await sleep(1500);
await A.click('.voice-bar button[aria-label="Turn camera off"]');
await sleep(1500);
check(
  (await B.$(".stage-spotlight")) === null &&
    (await B.$$(".stage-tile.video")).length === 0,
  "stopping clears B's spotlight and tile",
);
check((await B.$$(".voice-flag.live")).length === 0, "…and the flags");

// The stage carries the same control row as the sidebar (VoiceActions),
// and in full screen it is the only copy on the page. Pressing the mic
// on one moves the other: one row, one state.
const micNow = await A.$eval(
  '.stage-bar button[aria-label="Mute"], .stage-bar button[aria-label="Unmute"]',
  (e) => e.ariaLabel,
);
const flipped = micNow === "Mute" ? "Unmute" : "Mute";
await stageClick(A, `button[aria-label="${micNow}"]`);
await sleep(400);
check(
  (await A.$(`.voice-bar button[aria-label="${flipped}"]`)) !== null,
  "the stage bar's mic and the sidebar's are the same control",
);
await stageClick(A, `button[aria-label="${flipped}"]`);
await sleep(400);

// It gets off the video when nothing is moving, and comes back on a move.
await sleep(3000);
check(
  (await A.$(".stage-bar.idle")) !== null,
  "the stage bar fades while nothing moves",
);
await A.hover(".voice-stage");
await sleep(200);
check(
  (await A.$(".stage-bar.idle")) === null,
  "…and a pointer move over the stage brings it back",
);

// Hide chat: the timeline and composer leave and the stage takes the
// whole pane — including the height A dragged out earlier, which comes
// back with the chat. The choice is kept per browser, so put it back
// before the rest of the run.
const heightOf = (p, sel) =>
  p.$eval(sel, (e) => e.getBoundingClientRect().height);
const paneHeight = await heightOf(A, ".channel-view");
const draggedHeight = await heightOf(A, ".voice-stage");
await stageClick(A, 'button[aria-label="Hide chat"]');
await sleep(300);
check(
  (await A.$(".message-list")) === null && (await A.$(".composer")) === null,
  "hiding the chat takes the timeline and composer away",
);
const hiddenHeight = await heightOf(A, ".voice-stage");
check(
  hiddenHeight > draggedHeight && paneHeight - hiddenHeight < 4,
  `the stage fills the pane with the chat hidden (${Math.round(hiddenHeight)} of ${Math.round(paneHeight)})`,
);
check(
  (await A.$(".stage-resizer")) === null,
  "…and there is nothing left to drag against",
);
await stageClick(A, 'button[aria-label="Show chat"]');
await sleep(300);
check(
  (await A.$(".message-list")) !== null &&
    (await A.$(".composer")) !== null &&
    Math.abs((await heightOf(A, ".voice-stage")) - draggedHeight) < 4,
  "showing it again brings back the chat and the dragged height",
);

// Reduced motion zeroes --dur, and the hook reads its duration from that
// token: no animation at all, rather than a zero-length one.
await A.emulateMediaFeatures([
  { name: "prefers-reduced-motion", value: "reduce" },
]);
await resetFlips(A);

// B hangs up: gone from A's list, B's bar is gone.
await B.click('.voice-bar [aria-label="Disconnect"]');
list = await waitForParticipants(A, (l) => l.length === 1);
check(
  list.length === 1 && list[0].name === ada,
  "A sees B leave after disconnect",
);
check((await B.$(".voice-bar")) === null, "B's voice bar is gone");
check(
  (await flips(A)) === 0,
  `reduced motion drops the tile animation (${await flips(A)} flips)`,
);
await A.emulateMediaFeatures([
  { name: "prefers-reduced-motion", value: "no-preference" },
]);

// A closes the tab while connected: the gateway drops them for B.
await A.browserContext().close();
list = await waitForParticipants(B, (l) => l.length === 0);
check(list.length === 0, "B sees A dropped when A's tab closes");

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

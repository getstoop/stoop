// Setup step 3 / the admin Hosting tab: independent sections — public
// address, trusted proxies, Cloudflare TURN, the built-in Tailscale
// listener, your own relay — with one Save that sends only what changed,
// so each save below is checked to have left the other settings alone.
// Invite links follow the saved address, secrets never come back, and
// clearing falls back. The voice line reports what the saved settings
// add up to. The relay's effect on a voice join is checked through the
// API (a static relay; no real TURN needed).
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep, spaceMenu } from "./lib.mjs";

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
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const rpc = (path, body) =>
  A.evaluate(
    async (path, body) => {
      const r = await fetch(`/stoop.${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.json();
    },
    path,
    body,
  );

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

// Step 3: one dropdown of ways in; nothing is chosen for you.
check(
  (await text(A, ".setup-steps .current")).includes("Reaching your server"),
  "step 3 is reaching your server",
);
check(
  (await A.$(".reach-cloudflare")) !== null &&
    (await A.$(".reach-tailscale")) !== null &&
    (await A.$(".reach-own-relay")) !== null,
  "every setting has its own section, nothing to choose between",
);
check(
  (await A.$("button.reach-continue")) !== null &&
    (await text(A, "button.reach-continue")) === "Skip for now",
  "step is skippable",
);

// Public address + a Cloudflare TURN key; secrets are write-only.
check(
  (await text(A, ".reach-voice")).includes("direct only") ||
    (await text(A, ".reach-voice")).includes("isn't configured"),
  "the voice line starts with no relay in place",
);
check(
  await A.$eval("button.reach-save", (e) => e.disabled),
  "Save is disabled until something changes",
);
await A.type(
  'input[placeholder="https://chat.example.com"]',
  "https://chat.example.test/",
);
check(
  !(await A.$eval("button.reach-save", (e) => e.disabled)),
  "Save wakes up once a field changes",
);
// The page polls this endpoint on a timer to keep the Tailscale and
// LiveKit status live. Seeding the fields from a poll on top of someone
// mid-edit would eat what they typed, so it must not: unsaved changes win
// until they are saved.
await sleep(6000);
check(
  (await A.$eval(
    'input[placeholder="https://chat.example.com"]',
    (e) => e.value,
  )) === "https://chat.example.test/",
  "a status poll doesn't overwrite an unsaved edit",
);
await A.click("button.reach-save");
await sleep(800);
check(
  (await text(A, ".reach-saved")) === "Saved.",
  "the public address saves on its own",
);
check(
  await A.$eval("button.reach-save", (e) => e.disabled),
  "Save goes back to disabled once there's nothing left to save",
);
await A.click(".reach-cloudflare .reach-check input");
await sleep(200);
const inputs = await A.$$(".reach-relay input");
await inputs[0].type("cf-key-1");
await inputs[1].type("cf-token-1");
await A.click("button.reach-save");
await sleep(800);
check((await text(A, ".reach-saved")) === "Saved.", "saved");
check(
  (await text(A, ".reach-voice")).includes("works from anywhere") ||
    (await text(A, ".reach-voice")).includes("isn't configured"),
  "the voice line notices the relay",
);
check(
  (await A.$eval(".reach-relay input[type=password]", (e) => e.value)) === "" &&
    (
      await A.$eval(".reach-relay input[type=password]", (e) => e.placeholder)
    ).includes("saved"),
  "API token is not echoed back; placeholder says it's saved",
);
check(
  (await text(A, "button.reach-continue")) === "Continue",
  "skip button becomes Continue after saving",
);
await A.click("button.reach-continue");
await sleep(800);

// Step 4: the invite link uses the saved public address.
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
check(
  link.startsWith("https://chat.example.test/join/"),
  `invite link uses the public address: ${link}`,
);
await A.click("button.primary");
await sleep(1500);

// Admin page: same form, saved values shown; a static relay reaches the
// voice join through the API; clearing falls back.
await A.goto(`${base}/admin`, { waitUntil: "networkidle0" });
await sleep(500);
check(
  (await A.$(".reach-section")) === null,
  "admin: reachability isn't on the default tab",
);
await A.click('.settings-tab[data-tab="hosting"]');
await sleep(500);
check(
  (await A.$eval(
    '.reach-section input[placeholder="https://chat.example.com"]',
    (e) => e.value,
  )) === "https://chat.example.test",
  "admin page shows the saved public address",
);
check(
  await A.$eval(".reach-cloudflare .reach-check input", (e) => e.checked),
  "a saved key ticks the Cloudflare box on load",
);
check(
  (await A.$eval(".reach-section .reach-relay input", (e) => e.value)) ===
    "cf-key-1",
  "admin page shows the saved key id",
);
// LiveKit reports itself rather than hiding inside the Tailscale card:
// whether it is configured, and when it is, whether it answers. Both are
// valid here — CI runs without a sidecar — but the section is always there.
const lkState = await A.$eval(".reach-section .reach-livekit", (e) =>
  e.getAttribute("data-state"),
);
check(
  ["running", "stopped"].includes(lkState),
  `LiveKit has its own section on the hosting page (${lkState})`,
);
check(
  (await A.$eval(".reach-section .reach-livekit h4", (e) => e.textContent)) ===
    "LiveKit",
  "the LiveKit section is titled as itself",
);
await A.click(".reach-section .reach-own-relay .reach-check input");
await sleep(200);
const own = await A.$$(
  ".reach-section .reach-own-relay label:not(.reach-check) input",
);
await own[0].type("turns:turn.example.test:5349");
await own[1].type("stun:turn.example.test:3478");
await own[2].type("relay-user");
await own[3].type("relay-pass");
await A.click(".reach-section button.reach-save");
await sleep(800);
check(
  (await text(A, ".reach-section .reach-saved")) === "Saved.",
  "own relay saved",
);

const spaces = await rpc("chat.v1.ChatService/ListSpaces", {});
const chans = await rpc("chat.v1.ChatService/ListChannels", {
  spaceId: spaces.spaces[0].id,
});
const voice =
  chans.channels.find((c) => c.kind === "CHANNEL_KIND_VOICE") ??
  (
    await rpc("chat.v1.ChatService/CreateChannel", {
      spaceId: spaces.spaces[0].id,
      name: "lounge",
      kind: "CHANNEL_KIND_VOICE",
    })
  ).channel;
const join = await rpc("voice.v1.VoiceService/JoinVoiceChannel", {
  channelId: voice.id,
});
if (join.code === "unavailable") {
  // No LiveKit behind this server (CI): the join is refused before the
  // relay is consulted. The saved relay is still visible on the admin
  // page above; the voice spec (opt-in) covers the join itself.
  console.log("SKIP voice join offers the saved relay (voice not configured)");
} else {
  const ice = join.iceServers ?? [];
  check(
    ice.some(
      (s) =>
        s.urls?.includes("turns:turn.example.test:5349") &&
        s.username === "relay-user" &&
        s.credential === "relay-pass",
    ) && ice.some((s) => s.urls?.includes("stun:turn.example.test:3478")),
    `voice join offers the saved relay (${JSON.stringify(ice).slice(0, 80)}…)`,
  );
}

// Tailscale card: settings save and come back (node left disabled — the
// suite must not join a tailnet); the auth key is write-only.
check(
  (await A.$eval(
    ".reach-section .reach-tailscale .reach-check input",
    (e) => e.checked,
  )) === false,
  "tailscale starts disabled",
);
await A.click(".reach-section .reach-tailscale .reach-check input");
await sleep(200);
await A.$eval('.reach-section input[placeholder="stoop"]', (e) => {
  e.setSelectionRange(0, e.value.length);
});
await A.click('.reach-section input[placeholder="stoop"]', { clickCount: 3 });
await A.keyboard.press("Backspace");
await A.type('.reach-section input[placeholder="stoop"]', "porch");
await A.type(
  '.reach-section .reach-tailscale input[type="password"]',
  "tskey-auth-test",
);
await A.click(".reach-section .reach-tailscale .reach-check input"); // disable again before saving
await sleep(200);
await A.click(".reach-section button.reach-save");
await sleep(800);
check(
  (await text(A, ".reach-section .reach-saved")) === "Saved.",
  "tailscale settings saved",
);
const reach = await rpc("instance.v1.InstanceService/GetReachability", {});
check(
  !reach.reachability?.tailscale?.enabled &&
    reach.reachability?.tailscale?.hostname === "porch" &&
    reach.reachability?.tailscale?.hasAuthKey === true &&
    !reach.reachability?.tailscale?.authKey,
  `tailscale settings persisted, key write-only (${JSON.stringify(reach.reachability?.tailscale)})`,
);
check(!reach.tailscale?.enabled, "node is not running");
check(
  (await A.$eval(".reach-section .reach-relay input", (e) => e.value)) ===
    "cf-key-1",
  "the Cloudflare key survived a Tailscale save untouched",
);
// Unticking a relay box drops its settings, rather than leaving a hidden
// one still in force.
await A.click(".reach-cloudflare .reach-check input");
await sleep(200);
check(
  (await A.$(".reach-relay input")) === null &&
    !(await A.$eval("button.reach-save", (e) => e.disabled)),
  "unticking Cloudflare hides the fields and counts as a change",
);
await A.click(".reach-cloudflare .reach-check input");
await sleep(200);
check(
  (await A.$eval(".reach-relay input", (e) => e.value)) === "" &&
    (await A.$eval("button.reach-save", (e) => e.disabled)) === false,
  "re-ticking comes back empty — the key really was dropped",
);
// Nothing above was saved, so a reload puts the saved key back and
// leaves the form clean for the checks that follow.
await A.reload({ waitUntil: "networkidle0" });
await sleep(600);
await A.click('.settings-tab[data-tab="hosting"]');
await sleep(600);
check(
  (await A.$eval(".reach-relay input", (e) => e.value)) === "cf-key-1" &&
    (await A.$eval("button.reach-save", (e) => e.disabled)),
  "an unsaved untick is just that — the key is still there after a reload",
);

// Clear the public address: invite links fall back to the current origin.
await A.$eval(
  '.reach-section input[placeholder="https://chat.example.com"]',
  (e) => {
    e.value = "";
  },
);
await A.type(
  '.reach-section input[placeholder="https://chat.example.com"]',
  " ",
);
await A.click(".reach-section button.reach-save");
await sleep(800);
const cleared = await rpc("instance.v1.InstanceService/GetInstanceStatus", {});
check(!cleared.publicUrl, "public address cleared in the instance status");
const kept = await rpc("instance.v1.InstanceService/GetReachability", {});
check(
  kept.reachability?.cloudflare?.keyId === "cf-key-1",
  `saving the address alone leaves the relay alone (${kept.reachability?.cloudflare?.keyId})`,
);

// Trusted proxies: unrelated to the way in, applied without a restart.
// Only addresses and CIDR ranges are accepted.
await A.type(".reach-proxies input", "proxy.example.com");
await A.click(".reach-section button.reach-save");
await sleep(800);
check(
  (await text(A, ".reach-section .reach-form > .error")).includes(
    "not an IP address",
  ),
  "a hostname is refused as a proxy address",
);
await A.$eval(".reach-proxies input", (e) => {
  e.value = "";
});
await A.type(".reach-proxies input", "10.0.0.0/8, 192.168.1.5");
await A.click(".reach-section button.reach-save");
await sleep(900);
check(
  (await text(A, ".reach-section .reach-saved")) === "Saved.",
  "trusted proxies save",
);
const proxied = await rpc("instance.v1.InstanceService/GetReachability", {});
check(
  proxied.reachability?.trustedProxies?.cidrs?.join(",") ===
    "10.0.0.0/8,192.168.1.5",
  `saved proxies come back (${proxied.reachability?.trustedProxies?.cidrs})`,
);
check(
  !proxied.reachability?.publicUrl &&
    proxied.reachability?.cloudflare?.keyId === "cf-key-1" &&
    proxied.reachability?.turn?.urls?.join(",") ===
      "turns:turn.example.test:5349",
  "changing only the proxies left the address, relay and TURN alone",
);
await A.reload({ waitUntil: "networkidle0" });
await sleep(800);
await A.click('.settings-tab[data-tab="hosting"]');
await sleep(600);
check(
  (await A.$eval(".reach-proxies input", (e) => e.value)) ===
    "10.0.0.0/8, 192.168.1.5",
  "the form shows them again after a reload",
);
await A.goto(`${base}/s/${spaces.spaces[0].id}`, { waitUntil: "networkidle0" });
await sleep(500);
await spaceMenu(A, "Invite people");
await A.waitForSelector('button[title="Copy join link"]', { timeout: 3000 });
await A.evaluate(() => {
  navigator.clipboard.writeText = (t) => {
    window.__copied = t;
    return Promise.resolve();
  };
});
await A.click('button[title="Copy join link"]');
await sleep(300);
const copied = await A.evaluate(() => window.__copied);
check(
  typeof copied === "string" && copied.startsWith(`${base}/join/`),
  `invite links fall back to the current origin after clearing: ${copied}`,
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

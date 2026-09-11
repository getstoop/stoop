import type { Page } from "@playwright/test";
import { BASE } from "../e2e/seed.mjs";
import { expect, pastGate, reload, test } from "./lib";

declare global {
  interface Window {
    __copied?: string;
  }
}

// Setup step 3 / the admin Hosting tab: independent sections — public
// address, trusted proxies, Cloudflare TURN, the built-in Tailscale
// listener, your own relay — with one Save that sends only what changed,
// so each save below is checked to have left the other settings alone.
// Invite links follow the saved address, secrets never come back, and
// clearing falls back. The voice line reports what the saved settings
// add up to. The relay's effect on a voice join is checked through the
// API (a static relay; no real TURN needed).
// Ported from web/e2e/reachability.mjs (STOOP-238). The subject is the
// setup wizard, so this one drives the UI and seeds nothing: a seeded
// user would put /setup out of reach.
// What the voice join hands the client; rpc() is untyped, so the shape is
// named here rather than inferred.
interface IceServer {
  urls?: string[];
  username?: string;
  credential?: string;
}

test("reaching your server, in setup and on the admin page", async ({
  browser,
}) => {
  const A = await (await browser.newContext()).newPage();
  const suffix = String(Date.now() % 1000000);

  const rpc = (proc: string, body: unknown) =>
    A.evaluate(
      async (call) => {
        const r = await fetch(`/stoop.${call.proc}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(call.body),
        });
        return r.json();
      },
      { proc, body },
    );
  // The space header's actions (About, Invite, Copy link, Leave) live
  // behind its ⋮.
  const spaceMenu = async (p: Page, label: string) => {
    await p.locator(".sidebar-header .dots-menu-button").click();
    await p.locator(".dots-menu button", { hasText: label }).click();
  };
  const copied = () => A.evaluate(() => window.__copied ?? "");
  // The gate is decided on the first render, so wait for the app to
  // render something before looking for the way past.

  // The wizard is only reachable while the instance has no users.
  await A.goto("/");
  await A.waitForURL("**/setup");
  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill("correct horse battery");
  await A.locator('button[type="submit"]').click();
  await A.locator('input[placeholder="The Porch"]').fill("Stoop HQ");
  await A.locator('button[type="submit"]').click();

  // Step 3: one section per way in; nothing is chosen for you.
  const save = A.locator("button.reach-save");
  const saved = A.locator(".reach-saved");
  const publicUrl = A.locator('input[placeholder="https://chat.example.com"]');
  await expect(
    A.locator(".setup-steps .current"),
    "step 3 is reaching your server",
  ).toContainText("Reaching your server");
  for (const section of [
    ".reach-cloudflare",
    ".reach-tailscale",
    ".reach-own-relay",
  ]) {
    await expect(
      A.locator(section),
      `${section} has its own section, nothing to choose between`,
    ).toBeVisible();
  }
  await expect(
    A.locator("button.reach-continue"),
    "step is skippable",
  ).toHaveText("Skip for now");

  // Public address + a Cloudflare TURN key; secrets are write-only.
  await expect(
    A.locator(".reach-voice"),
    "the voice line starts with no relay in place",
  ).toContainText(/direct only|isn't configured/);
  await expect(save, "Save is disabled until something changes").toBeDisabled();
  await publicUrl.fill("https://chat.example.test/");
  await expect(save, "Save wakes up once a field changes").toBeEnabled();
  // The page polls this endpoint on a timer to keep the Tailscale and
  // LiveKit status live. Seeding the fields from a poll on top of someone
  // mid-edit would eat what they typed, so it must not: unsaved changes
  // win until they are saved. The wait is the test.
  await A.waitForTimeout(6000);
  await expect(
    publicUrl,
    "a status poll doesn't overwrite an unsaved edit",
  ).toHaveValue("https://chat.example.test/");
  await save.click();
  await expect(saved, "the public address saves on its own").toHaveText(
    "Saved.",
  );
  await expect(
    save,
    "Save goes back to disabled once there's nothing left to save",
  ).toBeDisabled();

  await A.locator(".reach-cloudflare .reach-check input").check();
  await A.locator('.reach-relay input:not([type="password"])').fill("cf-key-1");
  await A.locator('.reach-relay input[type="password"]').fill("cf-token-1");
  await save.click();
  await expect(saved, "saved").toHaveText("Saved.");
  await expect(
    A.locator(".reach-voice"),
    "the voice line notices the relay",
  ).toContainText(/works from anywhere|isn't configured/);
  await expect(
    A.locator('.reach-relay input[type="password"]'),
    "API token is not echoed back",
  ).toHaveValue("");
  await expect(
    A.locator('.reach-relay input[type="password"]'),
    "and the placeholder says it's saved",
  ).toHaveAttribute("placeholder", /saved/);
  await expect(
    A.locator("button.reach-continue"),
    "skip button becomes Continue after saving",
  ).toHaveText("Continue");
  await A.locator("button.reach-continue").click();

  // Step 4: the invite link uses the saved public address.
  await expect(
    A.locator(".link-box code"),
    "invite link uses the public address",
  ).toHaveText(/^https:\/\/chat\.example\.test\/join\//);
  await A.getByRole("button", { name: "Go to your space" }).click();

  // Admin page: same form, saved values shown; a static relay reaches the
  // voice join through the API; clearing falls back.
  await A.goto("/admin");
  const hosting = A.locator('.settings-tab[data-tab="hosting"]');
  await hosting.waitFor();
  await expect(
    A.locator(".reach-section"),
    "admin: reachability isn't on the default tab",
  ).toHaveCount(0);
  await hosting.click();

  const section = A.locator(".reach-section");
  const adminUrl = section.locator(
    'input[placeholder="https://chat.example.com"]',
  );
  const adminSave = section.locator("button.reach-save");
  const adminSaved = section.locator(".reach-saved");
  const cfKey = section.locator('.reach-relay input:not([type="password"])');
  const cloudflare = section.locator(".reach-cloudflare .reach-check input");

  await expect(
    adminUrl,
    "admin page shows the saved public address",
  ).toHaveValue("https://chat.example.test");
  await expect(
    cloudflare,
    "a saved key ticks the Cloudflare box on load",
  ).toBeChecked();
  await expect(cfKey, "admin page shows the saved key id").toHaveValue(
    "cf-key-1",
  );
  // LiveKit reports itself rather than hiding inside the Tailscale card:
  // whether it is configured, and when it is, whether it answers. Both are
  // valid here — CI runs without a sidecar — but the section is always there.
  const livekit = section.locator(".reach-livekit");
  expect(
    ["running", "stopped"],
    "LiveKit has its own section on the hosting page",
  ).toContain(await livekit.getAttribute("data-state"));
  await expect(
    livekit.locator("h4"),
    "the LiveKit section is titled as itself",
  ).toHaveText("LiveKit");

  await section.locator(".reach-own-relay .reach-check input").check();
  const own = section.locator(".reach-own-relay label:not(.reach-check) input");
  await own.nth(0).fill("turns:turn.example.test:5349");
  await own.nth(1).fill("stun:turn.example.test:3478");
  await own.nth(2).fill("relay-user");
  await own.nth(3).fill("relay-pass");
  await adminSave.click();
  await expect(adminSaved, "own relay saved").toHaveText("Saved.");

  const spaces = await rpc("chat.v1.ChatService/ListSpaces", {});
  const spaceId = spaces.spaces[0].id;
  const chans = await rpc("chat.v1.ChatService/ListChannels", { spaceId });
  const voice =
    chans.channels.find(
      (c: { kind: string }) => c.kind === "CHANNEL_KIND_VOICE",
    ) ??
    (
      await rpc("chat.v1.ChatService/CreateChannel", {
        spaceId,
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
    console.log(
      "SKIP voice join offers the saved relay (voice not configured)",
    );
  } else {
    const ice = join.iceServers ?? [];
    expect(
      ice.some(
        (s: IceServer) =>
          s.urls?.includes("turns:turn.example.test:5349") &&
          s.username === "relay-user" &&
          s.credential === "relay-pass",
      ),
      "voice join offers the saved TURN relay, with its credentials",
    ).toBe(true);
    expect(
      ice.some((s: IceServer) =>
        s.urls?.includes("stun:turn.example.test:3478"),
      ),
      "and the saved STUN server",
    ).toBe(true);
  }

  // Tailscale card: settings save and come back (node left disabled — the
  // suite must not join a tailnet); the auth key is write-only.
  const tailnet = section.getByLabel("Join my tailnet");
  await expect(tailnet, "tailscale starts disabled").not.toBeChecked();
  await tailnet.check();
  await section.locator('input[placeholder="stoop"]').fill("porch");
  await section
    .locator('.reach-tailscale input[type="password"]')
    .fill("tskey-auth-test");
  await tailnet.uncheck(); // disabled again before saving
  await adminSave.click();
  await expect(adminSaved, "tailscale settings saved").toHaveText("Saved.");

  const reach = await rpc("instance.v1.InstanceService/GetReachability", {});
  const ts = reach.reachability?.tailscale;
  expect(ts?.enabled, "tailscale stays disabled").toBeFalsy();
  expect(ts?.hostname, "the node name persisted").toBe("porch");
  expect(ts?.hasAuthKey, "the server holds an auth key").toBe(true);
  expect(ts?.authKey, "which it never hands back").toBeFalsy();
  expect(reach.tailscale?.enabled, "node is not running").toBeFalsy();
  await expect(
    cfKey,
    "the Cloudflare key survived a Tailscale save untouched",
  ).toHaveValue("cf-key-1");

  // Unticking a relay box drops its settings, rather than leaving a hidden
  // one still in force.
  await cloudflare.uncheck();
  await expect(
    section.locator(".reach-relay input"),
    "unticking Cloudflare hides the fields",
  ).toHaveCount(0);
  await expect(adminSave, "and counts as a change").toBeEnabled();
  await cloudflare.check();
  await expect(
    cfKey,
    "re-ticking comes back empty — the key really was dropped",
  ).toHaveValue("");
  await expect(adminSave, "and still counts as a change").toBeEnabled();

  // Nothing above was saved, so a reload puts the saved key back and
  // leaves the form clean for the checks that follow.
  await reload(A);
  await hosting.click();
  await expect(
    cfKey,
    "an unsaved untick is just that — the key is still there after a reload",
  ).toHaveValue("cf-key-1");
  await expect(adminSave, "and the form is clean again").toBeDisabled();

  // Clear the public address: invite links fall back to the current origin.
  await adminUrl.fill(" ");
  await adminSave.click();
  await adminSaved.waitFor();
  const cleared = await rpc(
    "instance.v1.InstanceService/GetInstanceStatus",
    {},
  );
  expect(
    cleared.publicUrl,
    "public address cleared in the instance status",
  ).toBeFalsy();
  const kept = await rpc("instance.v1.InstanceService/GetReachability", {});
  expect(
    kept.reachability?.cloudflare?.keyId,
    "saving the address alone leaves the relay alone",
  ).toBe("cf-key-1");

  // Trusted proxies: unrelated to the way in, applied without a restart.
  // Only addresses and CIDR ranges are accepted.
  const proxies = section.locator(".reach-proxies input");
  await proxies.fill("proxy.example.com");
  await adminSave.click();
  await expect(
    section.locator(".reach-form > .error"),
    "a hostname is refused as a proxy address",
  ).toContainText("not an IP address");
  await proxies.fill("10.0.0.0/8, 192.168.1.5");
  await adminSave.click();
  await expect(adminSaved, "trusted proxies save").toHaveText("Saved.");

  const proxied = await rpc("instance.v1.InstanceService/GetReachability", {});
  expect(
    proxied.reachability?.trustedProxies?.cidrs?.join(","),
    "saved proxies come back",
  ).toBe("10.0.0.0/8,192.168.1.5");
  expect(
    proxied.reachability?.publicUrl,
    "changing only the proxies left the address alone",
  ).toBeFalsy();
  expect(proxied.reachability?.cloudflare?.keyId, "and the relay").toBe(
    "cf-key-1",
  );
  expect(proxied.reachability?.turn?.urls?.join(","), "and the TURN URLs").toBe(
    "turns:turn.example.test:5349",
  );

  await reload(A);
  await hosting.click();
  await expect(proxies, "the form shows them again after a reload").toHaveValue(
    "10.0.0.0/8, 192.168.1.5",
  );

  // A shared link follows the same address as an invite link.
  await A.goto(`/s/${spaceId}`);
  await pastGate(A);
  await A.evaluate(() => {
    navigator.clipboard.writeText = (t: string) => {
      window.__copied = t;
      return Promise.resolve();
    };
  });
  await spaceMenu(A, "Copy link");
  await expect
    .poll(copied, {
      message: "a space link falls back to the current origin too",
    })
    .toBe(`${BASE}/s/${spaceId}`);

  await A.evaluate(() => {
    window.__copied = "";
  });
  await spaceMenu(A, "Invite people");
  await A.locator('button[title="Copy join link"]').click();
  await expect
    .poll(copied, {
      message: "invite links fall back to the current origin after clearing",
    })
    .toContain(`${BASE}/join/`);
});

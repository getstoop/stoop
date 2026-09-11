// Admin storage tab (STOOP-70): usage, the upload limit, cleanup on demand.
import { BASE as base, harness, reloadShared, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness();
const suffix = String(Date.now() % 1000000);
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
await A.click("button.reach-continue");
await sleep(800);
await A.click("button.primary");
await sleep(1200);

await A.goto(`${base}/admin`, { waitUntil: "networkidle0" });
await sleep(600);
check(
  (await A.$(".storage-section")) === null,
  "storage isn't on the default tab",
);
await A.click('.settings-tab[data-tab="storage"]');
const text = () =>
  A.$eval(".storage-section", (e) => e.innerText).catch(() => "");
await sleep(500);
const cleanupText = () => A.$eval(".cleanup-section", (e) => e.innerText);
check(
  await waitFor(async () => (await text()).includes("0 B in 0 files")),
  "usage line reads empty",
);
check(
  await waitFor(async () => (await text()).includes("no limit")),
  "no limit by default",
);
check((await A.$(".storage-bar")) === null, "no bar without a limit");

await A.$eval(".storage-quota input", (e) => {
  e.value = "";
});
await A.type(".storage-quota input", "1");
await A.click(".storage-section button.primary");
check(
  await waitFor(async () => (await text()).includes("limit 1.0 GB")),
  "limit saved and shown",
);
check(
  await waitFor(async () => (await text()).includes("1.0 GB left")),
  "free space shown",
);
check(
  await waitFor(async () => (await A.$(".storage-bar")) !== null),
  "bar shows against a limit",
);
await sleep(800);
await reloadShared(A, { waitUntil: "networkidle0" });
check(
  await waitFor(async () => (await text()).includes("limit 1.0 GB")),
  "limit persists",
);
await sleep(600);

await A.click(".cleanup-section .sweep-button");
await sleep(1200);
check(
  await waitFor(async () => (await cleanupText()).includes("Removed 0 files")),
  "cleanup runs and reports",
);

await A.$eval(".storage-quota input", (e) => {
  e.value = "";
});
await A.type(".storage-quota input", "0");
await A.click(".storage-section button.primary");
check(
  await waitFor(async () => (await text()).includes("no limit")),
  "limit cleared",
);
check(
  await waitFor(async () => (await A.$(".storage-bar")) === null),
  "bar hidden again",
);
await sleep(800);

await done();

// Admin storage tab (STOOP-70): usage, the upload limit, cleanup on demand.
import { harness, reloadShared, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness();
const { tokens } = await seed({ users: ["ada"] });
const A = await newPage("A");
await signIn(A, tokens.ada, "/admin");
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

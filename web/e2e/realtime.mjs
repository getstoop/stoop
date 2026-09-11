import { harness, reloadShared, seed, signIn, sleep, waitFor } from "./lib.mjs";

const { check, newPage, done } = await harness({
  consoleErrors: true,
  countPageErrors: false,
});
const { tokens } = await seed({ channels: ["general"] });

const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });

console.log("--- B lands in the app");
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });
console.log(
  "B landed:",
  new URL(B.url()).pathname,
  "status:",
  await B.$eval(".status-icon", (e) => e.className),
);
await A.type(".composer textarea", "msg1 right away");
await A.keyboard.press("Enter");
check(
  await waitFor(async () =>
    (await B.$eval(".message-list", (e) => e.innerText)).includes("msg1"),
  ),
  "B sees a message sent right after landing",
);
await sleep(4000);
await A.type(".composer textarea", "msg2 after 4s");
await A.keyboard.press("Enter");
check(
  await waitFor(async () =>
    (await B.$eval(".message-list", (e) => e.innerText)).includes("msg2"),
  ),
  "B sees a message sent a few seconds later",
);
console.log("--- B reloads");
await reloadShared(B, { waitUntil: "networkidle0" });
await sleep(1500);
await A.type(".composer textarea", "msg3 after reload");
await A.keyboard.press("Enter");
check(
  await waitFor(async () =>
    (await B.$eval(".message-list", (e) => e.innerText)).includes("msg3"),
  ),
  "B sees a message after reloading",
);
await done();

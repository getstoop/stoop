// Runs every spec against STOOP_E2E_BASE_URL, resetting the database in
// STOOP_E2E_DATABASE_URL before each so specs can assume a fresh instance.
// Exit status is non-zero if any spec fails.
//
//   pnpm e2e                    every spec
//   pnpm e2e replies edits      just those
//   pnpm e2e --shard 2/4        the second of four balanced slices (CI
//                               runs the slices as parallel jobs, each
//                               with its own server and database)

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const dbUrl =
  process.env.STOOP_E2E_DATABASE_URL ??
  "postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable";
const base = process.env.STOOP_E2E_BASE_URL ?? "http://localhost:8091";

// Colour for a terminal; piped output and NO_COLOR stay plain, FORCE_COLOR
// overrides (CI logs that render escapes).
const colour =
  !process.env.NO_COLOR &&
  (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));
const green = (s) => (colour ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (colour ? `\x1b[31m${s}\x1b[0m` : s);

// Order matters only for readability; each spec starts from a wiped DB.
const SPECS = [
  "setup",
  "registration",
  "invites",
  "members",
  "profile",
  "usercard",
  "pronouns",
  "realtime",
  "mentions",
  "unreads",
  "replies",
  "presence",
  "edits",
  "settings",
  "reactions",
  "formatting",
  "shortcodes",
  "composer-styling",
  "uploads",
  "attachments",
  "reachability",
  "login-providers",
  "unfurl",
  "themes",
  "history",
  "window",
  "mobile",
  "dms",
  "status",
  "mutes",
  "security",
  "storage",
  "bans",
  "space-about",
  "channel-topic",
  "default-channel",
  // Needs a LiveKit server the app is configured for and fake media
  // devices; opt in with STOOP_E2E_VOICE=1 (CI doesn't).
  ...(process.env.STOOP_E2E_VOICE ? ["voice"] : []),
];

// Seconds each spec took on a GitHub runner, so --shard can hand out
// slices of even length rather than even count. Only balance depends on
// these; a spec missing here counts as typical. The summary prints fresh
// numbers after every run — copy them back when the shape changes.
const TYPICAL = 25;
const WEIGHT = {
  window: 60,
  mutes: 40,
  bans: 38,
  registration: 37,
  dms: 35,
  pronouns: 34,
  mentions: 34,
  members: 33,
  reachability: 31,
  invites: 31,
  unreads: 30,
  "space-about": 30,
  presence: 29,
  "channel-topic": 27,
  settings: 26,
  uploads: 26,
  history: 25,
  setup: 24,
  status: 22,
  formatting: 21,
  realtime: 21,
  profile: 21,
  reactions: 20,
  attachments: 20,
  "login-providers": 18,
  usercard: 18,
  replies: 18,
  edits: 18,
  themes: 16,
  mobile: 16,
  "composer-styling": 16,
  storage: 15,
  unfurl: 14,
  shortcodes: 13,
  security: 5,
};

// Longest-first onto the lightest shard: a classic greedy split that
// keeps the slowest spec from sharing a slice with much else.
function shard(names, index, total) {
  const loads = Array(total).fill(0);
  const picked = [];
  for (const name of [...names].sort(
    (a, b) => (WEIGHT[b] ?? TYPICAL) - (WEIGHT[a] ?? TYPICAL),
  )) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest] += WEIGHT[name] ?? TYPICAL;
    if (lightest === index - 1) picked.push(name);
  }
  return names.filter((n) => picked.includes(n));
}

const args = process.argv.slice(2);
let shardSpec = null;
const only = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--shard=")) shardSpec = a.slice("--shard=".length);
  else if (a === "--shard") shardSpec = args[++i];
  // `pnpm e2e -- --shard 1/4` hands the separator through as an argument.
  else if (a !== "--") only.push(a);
}
let specs = only.length ? SPECS.filter((s) => only.includes(s)) : SPECS;
if (only.includes("voice") && !specs.includes("voice")) {
  console.error("voice spec needs STOOP_E2E_VOICE=1 (and a LiveKit server)");
  process.exit(2);
}
if (shardSpec !== null) {
  const m = /^(\d+)\/(\d+)$/.exec(shardSpec ?? "");
  const index = m ? Number(m[1]) : 0;
  const total = m ? Number(m[2]) : 0;
  if (!m || index < 1 || index > total) {
    console.error("--shard wants N/M with 1 <= N <= M, e.g. --shard 2/4");
    process.exit(2);
  }
  specs = shard(specs, index, total);
  console.log(`shard ${index}/${total}: ${specs.join(", ")}`);
}

async function resetDb() {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("TRUNCATE users CASCADE");
    await client.query("DELETE FROM instance_settings");
  } finally {
    await client.end();
  }
}

async function serverUp() {
  try {
    const res = await fetch(`${base}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

function runSpec(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, `${name}.mjs`)], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

if (!(await serverUp())) {
  console.error(
    `no server at ${base} (start one: make build && STOOP_LISTEN_ADDR=:8091 STOOP_AUTH_RATE_LIMIT=0 ./bin/stoop)`,
  );
  process.exit(2);
}

const results = [];
for (const name of specs) {
  console.log(`\n=== ${name} ===`);
  await resetDb();
  const started = Date.now();
  const code = await runSpec(name);
  results.push([name, code, Math.round((Date.now() - started) / 1000)]);
}
await resetDb();

console.log("\n=== summary ===");
const width = Math.max(...results.map(([name]) => name.length));
for (const [name, code, seconds] of results) {
  const line = `${name.padEnd(width)} ${String(seconds).padStart(4)}s`;
  console.log(code === 0 ? green(`ok   ${line}`) : red(`FAIL ${line}`));
}
const failed = results.filter(([, code]) => code !== 0).length;
const total = results.reduce((sum, [, , seconds]) => sum + seconds, 0);
console.log(
  failed
    ? red(`${results.length - failed} passed, ${failed} failed (${total}s)`)
    : green(`${results.length} passed (${total}s)`),
);
process.exit(failed ? 1 : 0);

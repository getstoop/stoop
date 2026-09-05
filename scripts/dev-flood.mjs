#!/usr/bin/env node
// Floods a space on the dev instance with messages, straight into
// Postgres, so search and history can be tried at a size the seed never
// reaches. Authors are the space's members, channels its text channels,
// timestamps spread over the last --days; ids are UUIDv7 for those
// times, so the messages sort into history where they belong.
//
//   node scripts/dev-flood.mjs --space "The Stoop" --count 20000 --days 90
//
// Needs the dev Postgres (make dev-services); the server may be running.
// Nothing here goes through the API, so no activity, unread or realtime
// state is touched: reload the tab to see the messages.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DB = (() => {
  try {
    return new URL(process.env.STOOP_DATABASE_URL ?? "").pathname.slice(1) || "stoop";
  } catch {
    return "stoop";
  }
})();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const SPACE = arg("space", "The Stoop");
const COUNT = Number(arg("count", "5000"));
const DAYS = Number(arg("days", "60"));
if (!Number.isInteger(COUNT) || COUNT < 1 || !Number.isInteger(DAYS) || DAYS < 1) {
  console.error("usage: dev-flood.mjs [--space NAME] [--count N] [--days N]");
  process.exit(2);
}

// Neighbourhood chatter in the seed's world. Two are combined per message
// most of the time, so the same words recur in different company.
const LINES = [
  "Anyone seen the grey cat from number 12?",
  "The streetlight on Poplar is out again, filed a 311 ticket",
  "Sprinkler on the corner lot has been running since six",
  "Borrowing the ladder from the tool library tomorrow, back by Sunday",
  "Tomatoes are finally in, come and take some before the squirrels do",
  "Parcel for 14b delivered to my porch by mistake, come get it",
  "Game night is at eight, bring a controller if you have a spare",
  "Yard sale on Saturday, mostly books and a bandsaw that needs a blade",
  "Who left the garden gate open last night?",
  "The bandsaw is fixed, ask before you take it",
  "Watering rota for next week is on the shed door",
  "Lost a set of keys with a green fob near the bus stop",
  "Found a red scooter by the bins, anyone missing one?",
  "Block party planning: we need a grill and someone with a van",
  "Recycling got skipped on our side of the street again",
  "Free couch on the curb outside 22, it is in better shape than it looks",
  "Power flickered twice this afternoon, anyone else?",
  "The courier guessed at the house number again",
  "Seedlings are ready, peppers and basil, first come first served",
  "Does anyone have a long extension lead I could borrow for an hour?",
  "Heard the bandsaw at midnight, who was that",
  "Poplar and 14th is closed for roadworks until Thursday",
  "Composting workshop in the garden this Saturday at ten",
  "The Saturn finally boots, one working cartridge slot is enough",
  "Ranked at unsociable hours again, join if you are up",
  "Patch notes are out and the arguing has begun",
  "Screenshot from last night, do not open if you have not finished it",
  "Emulator settings that fixed the CRT flicker, ask me",
  "Tool list is updated, the drill has a new battery",
  "Someone parked across the garden gate, white van, no note",
  "New neighbours at 19, say hello if you see them",
  "The gate code changed, check the shed door",
  "Lost and found box in the library is overflowing, claim your stuff",
  "Streetlight fixed, only took three weeks",
  "Basil is bolting, cut it back if you walk past",
  "Bandsaw blade replaced, it cuts straight now",
  "Friday game night moved to nine this week",
  "The porch light timer is wrong again after the clocks changed",
  "Anyone have a 13mm socket, mine walked off",
  "Tomato bragging thread: mine are bigger",
];

const sql = `
CREATE FUNCTION pg_temp.uuid7(ts timestamptz) RETURNS uuid AS $f$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        placing substring(int8send(floor(extract(epoch FROM ts) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1), 'hex')::uuid
$f$ LANGUAGE sql VOLATILE;

DO $d$
DECLARE
  sid uuid;
  chans uuid[];
  people uuid[];
  lines text[] := ARRAY[${LINES.map((l) => `$q$${l}$q$`).join(",\n    ")}];
  n int;
BEGIN
  SELECT id INTO sid FROM spaces WHERE name = $q$${SPACE}$q$;
  IF sid IS NULL THEN RAISE EXCEPTION 'no space named %', $q$${SPACE}$q$; END IF;
  chans := ARRAY(SELECT id FROM channels WHERE space_id = sid AND kind = 1);
  people := ARRAY(SELECT user_id FROM space_members WHERE space_id = sid);
  IF chans = '{}' OR people = '{}' THEN RAISE EXCEPTION 'space has no text channels or members'; END IF;

  INSERT INTO messages (id, channel_id, author_id, content, created_at)
  SELECT pg_temp.uuid7(t.ts), chans[1 + floor(random() * array_length(chans, 1))],
         people[1 + floor(random() * array_length(people, 1))],
         lines[1 + floor(random() * array_length(lines, 1))]
           || CASE WHEN random() < 0.6 THEN '. ' || lines[1 + floor(random() * array_length(lines, 1))] ELSE '' END,
         t.ts
  FROM generate_series(1, ${COUNT}) g,
       LATERAL (SELECT now() - (random() * interval '${DAYS} days') - (g * interval '0 seconds') AS ts) t;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE channels c SET last_message_id = (SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1)
  WHERE c.id = ANY(chans);
  RAISE NOTICE 'inserted % messages into % channels of %', n, array_length(chans, 1), $q$${SPACE}$q$;
END
$d$;
`;

const started = Date.now();
const result = spawnSync(
  "docker",
  [
    "compose", "-f", join(here, "..", "deploy", "docker-compose.dev.yml"),
    "exec", "-T", "postgres", "psql", "-U", "stoop", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1",
  ],
  { input: sql, stdio: ["pipe", "inherit", "inherit"] },
);
if (result.status !== 0) {
  console.error("flood failed: is the dev Postgres up? (make dev-services)");
  process.exit(1);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

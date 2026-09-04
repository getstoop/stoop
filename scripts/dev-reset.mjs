#!/usr/bin/env node
// Wipes the dev database and seeds a fixed cast: eight accounts (password
// "password1") with profiles, two spaces with descriptions, welcome text
// and channels, and an overlapping membership between them, plus the
// extras — more neighbours in The Stoop, there so its member list is long
// enough to scroll, fold and search. The seed never changes, so the
// logins are worth memorising.
//
// `--append` skips the wipe and the named cast and only adds the extras
// to a running instance that already has casey.
//
// Needs the dev Postgres (make dev-services) and a running server.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STOOP_URL ?? "http://localhost:8091";
// The database to wipe follows STOOP_DATABASE_URL, so pointing STOOP_URL
// at a second instance empties that instance's database rather than the
// dev one.
const DB = (() => {
  try {
    return new URL(process.env.STOOP_DATABASE_URL ?? "").pathname.slice(1) || "stoop";
  } catch {
    return "stoop";
  }
})();
const PASSWORD = process.env.SEED_PASSWORD ?? "password1";

// The cast. The first account registers on an empty instance and so
// becomes the server admin; usernames are first names, on purpose.
//
// Profiles (shown on the card you get by clicking a name) are filled in
// unevenly on purpose: most have both, dave has only a bio, tomas only
// pronouns, and kenji neither. A cast where everyone had both would mean
// never seeing a card with nothing on it.
const USERS = [
  {
    username: "casey",
    name: "Casey Nolan",
    pronouns: "she/her",
    bio: "Runs the tool library out of the back room. Ask before you take the bandsaw.",
  },
  {
    username: "marisol",
    name: "Marisol Vega",
    pronouns: "she/her",
    bio: "Corner lot, third bed from the gate. I will talk about tomatoes until you leave.",
  },
  {
    username: "dave",
    name: "Dave Okonkwo",
    bio: "Files the 311 tickets nobody else wants to. Streetlight on Poplar is mine.",
  },
  {
    username: "priya",
    name: "Priya Raman",
    pronouns: "she/her",
    bio: "Here for the garden rota and the Friday game night, in that order. Usually both.",
  },
  { username: "tomas", name: "Tomas Brandt", pronouns: "he/him" },
  {
    username: "jules",
    name: "Jules Ferrand",
    pronouns: "they/them",
    bio: "Started the Arcade so I would have someone to lose to. Ranked at unsociable hours.",
  },
  { username: "kenji", name: "Kenji Sato" },
  {
    username: "nina",
    name: "Nina Petrova",
    pronouns: "she/her",
    bio: "Two CRTs, one working cartridge slot, no shelf space. Ask me about the Saturn.",
  },
];

// Names only: they exist to make The Stoop's member list long. The
// profile card for any of them is the empty state.
const EXTRAS = [
  ["omar", "Omar Haddad"], ["lena", "Lena Fischer"], ["kwame", "Kwame Mensah"],
  ["sofia", "Sofia Ricci"], ["jonas", "Jonas Lind"], ["marta", "Marta Kowalski"],
  ["yuki", "Yuki Tanaka"], ["ana", "Ana Souza"], ["ravi", "Ravi Nair"],
  ["ines", "Ines Duarte"], ["hugo", "Hugo Park"], ["freya", "Freya Holm"],
  ["mateo", "Mateo Cruz"], ["amara", "Amara Osei"], ["leo", "Leo Marchetti"],
  ["zara", "Zara Ahmed"], ["felix", "Felix Brand"], ["noor", "Noor Rahimi"],
].map(([username, name]) => ({ username, name }));

// Two spaces sharing a user pool: priya and nina are in both, and the
// gaming space is owned by someone who is not the server admin.
const SPACES = [
  {
    name: "The Stoop",
    description: "Neighbours of 14th & Poplar: porch talk, borrowed tools, and who left the sprinkler on.",
    welcome: [
      "**Welcome to the block.** 👋",
      "",
      "- Say hello in #general — name, house number, and one thing you'd lend a neighbour.",
      "- #stoop-sale is for curb finds and yard sales. No businesses, no landlords.",
      "- Cats, keys and misdelivered parcels go to #lost-and-found.",
      "- Disagreements happen on the sidewalk, not here.",
      "",
      "The garden gate code and the shared tool list live in #garden.",
    ].join("\n"),
    channels: [
      { name: "general", topic: "Porch talk: anything and everything about the block." },
      { name: "stoop-sale", topic: "Free on the curb, yard sales, and hand-me-downs." },
      { name: "lost-and-found", topic: "Lost cats, found keys, and parcels the courier guessed at." },
      { name: "block-watch", topic: "Broken streetlights, odd cars, and open 311 tickets." },
      { name: "garden", topic: "The corner lot: watering rota, seedlings, and tomato bragging." },
      { name: "front-steps", kind: "CHANNEL_KIND_VOICE", topic: "Open mic on the steps. Someone is usually out here." },
    ],
    members: [
      { username: "casey", role: "owner" },
      { username: "marisol", role: "admin" },
      { username: "dave", role: "member" },
      { username: "priya", role: "member" },
      { username: "tomas", role: "member" },
      { username: "nina", role: "member" },
      ...EXTRAS.map((u) => ({ username: u.username, role: "member" })),
    ],
  },
  {
    name: "Basement Arcade",
    description: "A small guild that plays badly, plays often, and mostly starts after nine.",
    welcome: [
      "**Welcome to the Arcade.** 🕹️",
      "",
      "- Post what you're playing in #lfg and someone will show up. Probably.",
      "- Clips and 3 a.m. victory posts belong in #screenshots.",
      "- Game night is Fridays at eight in the *front-steps*… sorry, *game-night* voice channel.",
      "- No spoilers in a channel name or the first line of a message.",
      "",
      "Ranked rage goes in #patch-notes, where it belongs.",
    ].join("\n"),
    channels: [
      { name: "general", topic: "Between-match chatter and general noise." },
      { name: "lfg", topic: "Looking for a group: what you're playing, and when." },
      { name: "patch-notes", topic: "Balance changes, updates, and the arguing that follows." },
      { name: "screenshots", topic: "Clips, screenshots, and 3 a.m. victory posts." },
      { name: "retro", topic: "Cartridges, emulators, and CRT nonsense." },
      { name: "game-night", kind: "CHANNEL_KIND_VOICE", topic: "Fridays at eight. Mics optional, complaining mandatory." },
    ],
    members: [
      { username: "jules", role: "owner" },
      { username: "kenji", role: "admin" },
      { username: "casey", role: "admin" },
      { username: "priya", role: "member" },
      { username: "nina", role: "member" },
    ],
  },
];

const ADMIN = USERS[0].username;
const APPEND = process.argv.includes("--append");

async function rpc(proc, body, token) {
  const res = await fetch(`${BASE}/stoop.${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // The auth rate limit (20/min) is real; the extras alone need more.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 5000));
    return rpc(proc, body, token);
  }
  if (!res.ok) {
    throw new Error(`${proc}: ${res.status} ${(await res.text()).trim()}`);
  }
  return res.json();
}

async function serverUp() {
  try {
    return (await fetch(`${BASE}/healthz`)).ok;
  } catch {
    return false;
  }
}

// The wipe is psql in the dev Postgres container; the seed is all API.
function wipe() {
  const result = spawnSync(
    "docker",
    [
      "compose", "-f", join(here, "..", "deploy", "docker-compose.dev.yml"),
      "exec", "-T", "-e", "PGOPTIONS=-c client_min_messages=warning",
      "postgres", "psql", "-U", "stoop", "-d", DB, "-q",
      "-c", "TRUNCATE users CASCADE",
      "-c", "DELETE FROM instance_settings",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (result.status !== 0) {
    console.error("wipe failed: is the dev Postgres up? (make dev-services)");
    process.exit(1);
  }
}

async function seedUsers(users, ids = {}, tokens = {}) {
  for (const user of users) {
    // Every account after the first is created by the admin, which the
    // registration policy exempts from invites.
    await rpc("auth.v1.AuthService/Register",
      { username: user.username, password: PASSWORD }, tokens[ADMIN]);
    const login = await rpc("auth.v1.AuthService/Login",
      { username: user.username, password: PASSWORD });
    ids[user.username] = login.user.id;
    tokens[user.username] = login.token;
    await rpc("auth.v1.AuthService/UpdateProfile", {
      displayName: user.name,
      pronouns: user.pronouns ?? "",
      bio: user.bio ?? "",
    }, login.token);
  }
  return { ids, tokens };
}

async function seedSpace(space, ids, token) {
  const { space: created, defaultChannel } = await rpc(
    "chat.v1.ChatService/CreateSpace", { name: space.name }, token);
  await rpc("chat.v1.ChatService/UpdateSpace", {
    spaceId: created.id, description: space.description, welcome: space.welcome,
  }, token);

  // The space is born with one channel; it takes the first spec, and the
  // rest are created in order.
  const [first, ...rest] = space.channels;
  await rpc("chat.v1.ChatService/UpdateChannel",
    { channelId: defaultChannel.id, name: first.name, topic: first.topic }, token);
  for (const spec of rest) {
    const { channel } = await rpc("chat.v1.ChatService/CreateChannel",
      { spaceId: created.id, name: spec.name, kind: spec.kind ?? "CHANNEL_KIND_TEXT" }, token);
    await rpc("chat.v1.ChatService/UpdateChannel",
      { channelId: channel.id, topic: spec.topic }, token);
  }

  for (const member of space.members) {
    if (member.username === ADMIN) continue; // the creator is already in
    await rpc("chat.v1.ChatService/AddMember",
      { spaceId: created.id, userId: ids[member.username] }, token);
    if (member.role === "admin") {
      await rpc("chat.v1.ChatService/SetMemberRole",
        { spaceId: created.id, userId: ids[member.username], role: "SPACE_ROLE_ADMIN" }, token);
    }
  }

  // Handing the space over last leaves the admin who created it an admin,
  // which is what the member list above claims.
  const owner = space.members.find((m) => m.role === "owner");
  if (owner.username !== ADMIN) {
    await rpc("chat.v1.ChatService/TransferOwnership",
      { spaceId: created.id, userId: ids[owner.username] }, token);
  }
}

// Adds the extras to The Stoop on an instance that already has the cast.
async function appendExtras() {
  const admin = await rpc("auth.v1.AuthService/Login",
    { username: ADMIN, password: PASSWORD });
  const { spaces } = await rpc("chat.v1.ChatService/ListSpaces", {}, admin.token);
  const stoop = spaces.find((s) => s.name === SPACES[0].name);
  if (!stoop) {
    console.error(`no "${SPACES[0].name}" here: run a full reset instead`);
    process.exit(1);
  }
  const { members } = await rpc("chat.v1.ChatService/ListMembers",
    { spaceId: stoop.id }, admin.token);
  const present = new Set(members.map((m) => m.username));
  const missing = EXTRAS.filter((u) => !present.has(u.username));
  console.log(`adding ${missing.length} extras to ${stoop.name}…`);
  const { ids, tokens } = await seedUsers(missing, {}, { [ADMIN]: admin.token });
  for (const user of missing) {
    await rpc("chat.v1.ChatService/AddMember",
      { spaceId: stoop.id, userId: ids[user.username] }, admin.token);
  }
  for (const token of Object.values(tokens)) {
    await rpc("auth.v1.AuthService/Logout", {}, token);
  }
}

function pad(text, width) {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function summary() {
  const nameWidth = Math.max(...USERS.map((u) => u.username.length)) + 2;
  const displayWidth = Math.max(...USERS.map((u) => u.name.length)) + 2;
  const pronounWidth =
    Math.max("pronouns".length, ...USERS.map((u) => (u.pronouns ?? "").length)) + 2;

  const lines = [];
  lines.push("");
  lines.push(`Signed out and ready at ${BASE}. Every password is "${PASSWORD}".`);
  lines.push("");
  lines.push(`  ${pad("username", nameWidth)}${pad("name", displayWidth)}` +
    `${pad("pronouns", pronounWidth)}${pad("server", 9)}spaces`);
  for (const user of USERS) {
    const spaces = SPACES.flatMap((space) => {
      const member = space.members.find((m) => m.username === user.username);
      return member ? [`${space.name} (${member.role})`] : [];
    });
    lines.push(`  ${pad(user.username, nameWidth)}${pad(user.name, displayWidth)}` +
      `${pad(user.pronouns ?? "—", pronounWidth)}` +
      `${pad(user.username === ADMIN ? "admin" : "member", 9)}${spaces.join(", ")}`);
  }
  const noBio = USERS.filter((u) => !u.bio).map((u) => u.username);
  lines.push("");
  lines.push(`  Profiles show on the card you get by clicking a name. ` +
    `No bio: ${noBio.join(", ")} — the empty states need somewhere to show.`);
  lines.push(`  Plus ${EXTRAS.length} extras in The Stoop, names only: ` +
    `${EXTRAS.map((u) => u.username).join(", ")}.`);
  for (const space of SPACES) {
    const channels = space.channels
      .map((c) => (c.kind === "CHANNEL_KIND_VOICE" ? `🔊 ${c.name}` : `#${c.name}`))
      .join("  ");
    lines.push("");
    lines.push(`  ${space.name} — ${space.description}`);
    lines.push(`  ${channels}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
}

if (!(await serverUp())) {
  console.error(`no server at ${BASE}: start it first (make dev), then rerun make dev-reset`);
  process.exit(2);
}

if (APPEND) {
  await appendExtras();
  process.exit(0);
}

console.log(`wiping database ${DB}…`);
wipe();

console.log(`seeding ${USERS.length + EXTRAS.length} accounts…`);
const { ids, tokens } = await seedUsers(USERS);
await seedUsers(EXTRAS, ids, tokens);

for (const space of SPACES) {
  console.log(`seeding ${space.name} (${space.channels.length} channels, ${space.members.length} members)…`);
  await seedSpace(space, ids, tokens[ADMIN]);
}

// Drop the seeding sessions so every account starts from a clean login.
for (const token of Object.values(tokens)) {
  await rpc("auth.v1.AuthService/Logout", {}, token);
}

summary();

// Builds the instance the mobile flows sign in to, over RPC, with the
// browser suite's seed, and prints what the flows need as KEY=value lines
// for scripts/mobile-e2e.sh to hand Maestro.
//
// ada and dee are in Book club, which has a description and where dee
// mentions ada; ada is also in Climbing crew, unread, and Garden swap,
// muted. bea has an account but no space; cleo has neither and arrives
// through the invite.

import { BASE, seed } from "../../web/e2e/seed.mjs";

const space = "Book club";
const s = await seed({
  users: ["ada", "bea", "dee"],
  members: ["ada", "dee"],
  space,
  invite: true,
});
const path = new URL(s.invite.url).pathname;
const { ada, dee } = s.tokens;

await rpc(
  "chat.v1.ChatService/UpdateSpace",
  { spaceId: s.space.id, description: "Reading The Overstory" },
  ada,
);
await rpc(
  "chat.v1.ChatService/SendMessage",
  {
    channelId: s.channels.general,
    content: `<@u:${s.ids.ada}:ada${s.suffix}> who's bringing the second copy?`,
  },
  dee,
);

const crew = await rpc("chat.v1.ChatService/CreateSpace", { name: "Climbing crew" }, ada);
await rpc("chat.v1.ChatService/AddMember", { spaceId: crew.space.id, userId: s.ids.dee }, ada);
await rpc(
  "chat.v1.ChatService/SendMessage",
  { channelId: crew.defaultChannel.id, content: "Gym's closed Monday, outdoors instead?" },
  dee,
);

const garden = await rpc("chat.v1.ChatService/CreateSpace", { name: "Garden swap" }, ada);
await rpc("chat.v1.ChatService/SetSpaceMuted", { spaceId: garden.space.id, muted: true }, ada);

const env = {
  SERVER: BASE,
  // The same server by another address: to the app, a second server.
  SECOND_SERVER: BASE.replace("localhost", "127.0.0.1"),
  PASSWORD: s.password,
  MEMBER: `ada${s.suffix}`,
  OUTSIDER: `bea${s.suffix}`,
  NEWCOMER: `cleo${s.suffix}`,
  SPACE: space,
  INVITE_LINK: s.invite.url,
  // What the web's open-in-app page fires for that invite.
  OPEN_LINK: `stoop://open?${new URLSearchParams({ server: BASE, path })}`,
};
for (const [key, value] of Object.entries(env)) console.log(`${key}=${value}`);

async function rpc(proc, body, token) {
  const res = await fetch(`${BASE}/stoop.${proc}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`${proc}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

// Builds the instance the mobile flows sign in to, over RPC, with the
// browser suite's seed, and prints what the flows need as KEY=value lines
// for scripts/mobile-e2e.sh to hand Maestro.
//
// ada and dee are in Book club, which has a description and where dee
// mentions ada in general, posts in random, and off-topic is muted by
// ada. dee has written more than a page in chapters, the last two since
// ada read it. ada is also in Climbing crew, unread, and Garden swap,
// muted. In chapter-nine ada started a thread that dee has replied to
// four times, the last two since ada read it, and dee's question after it
// has no thread yet; ada has read the channel. bea has an account but no
// space; cleo has neither and arrives through the invite. formatting
// holds ada's messages in Markdown, read.

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

await rpc(
  "chat.v1.ChatService/SendMessage",
  { channelId: s.channels.random, content: "Halfway through, no spoilers please" },
  dee,
);
const offTopic = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "off-topic", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
await rpc("chat.v1.ChatService/SetChannelMuted", { channelId: offTopic.channel.id, muted: true }, ada);

// More than the app's first page (50), one at a time so they keep their
// order; ada has read all but the last two. None mentions ada, so the
// space's counts are as above.
const chapters = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "chapters", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const CHAPTERS = 55;
for (let n = 1; n <= CHAPTERS; n++) {
  const { message } = await rpc(
    "chat.v1.ChatService/SendMessage",
    { channelId: chapters.channel.id, content: `Chapter ${n} notes` },
    dee,
  );
  if (n === CHAPTERS - 2) {
    await rpc("chat.v1.ChatService/MarkChannelRead", { channelId: chapters.channel.id, messageId: message.id }, ada);
  }
}

const nine = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "chapter-nine", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const { message: root } = await rpc(
  "chat.v1.ChatService/SendMessage",
  { channelId: nine.channel.id, content: "Finished chapter 9. No spoilers here, but I need to talk about it." },
  ada,
);
const replies = [
  "Two more pages and I'm there.",
  "Waiting. Very patiently.",
  "Same. Reading ahead was a mistake.",
  "The fire scene?? I had to put it down for a minute.",
];
for (const [n, content] of replies.entries()) {
  const { message } = await rpc(
    "chat.v1.ChatService/SendMessage",
    { channelId: nine.channel.id, content, threadRootId: root.id },
    dee,
  );
  if (n === 1) {
    await rpc("chat.v1.ChatService/MarkThreadRead", { messageId: root.id, replyId: message.id }, ada);
  }
}
const { message: question } = await rpc(
  "chat.v1.ChatService/SendMessage",
  { channelId: nine.channel.id, content: "Who's hosting Thursday?" },
  dee,
);
await rpc("chat.v1.ChatService/MarkChannelRead", { channelId: nine.channel.id, messageId: question.id }, ada);

// In formatting, ada's own messages in Markdown, all read by her: every
// inline mark with a link, a channel link to random, @here and dee
// mentioned, emoji among the words; a link whose words hide a spoiler; a
// message that is one spoiler, a line long, so a tap on the middle of the
// message lands on it; and one of only emoji (markdown.yaml).
const formatting = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "formatting", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const formatted = [
  "**Bold** *italic* __underline__ ~~strike~~ `code` and [the docs](https://example.com), " +
    `over in <#${s.channels.random}:random> for @here and <@u:${s.ids.dee}:dee${s.suffix}>, ` +
    "with a tree 🌳 among the words of a line long enough to wrap",
  "Read [the ||burnt|| ending](https://example.com) later",
  "||The narrator was the oldest tree 🍂||",
  "🌳🍂",
];
let lastFormatted;
for (const content of formatted) {
  const sent = await rpc("chat.v1.ChatService/SendMessage", { channelId: formatting.channel.id, content }, ada);
  lastFormatted = sent.message;
}
await rpc(
  "chat.v1.ChatService/MarkChannelRead",
  { channelId: formatting.channel.id, messageId: lastFormatted.id },
  ada,
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
  // A plain member of the space, who moderates nothing.
  POSTER: `dee${s.suffix}`,
  OUTSIDER: `bea${s.suffix}`,
  NEWCOMER: `cleo${s.suffix}`,
  SPACE: space,
  // For flows that change the space mid-way, as another device would:
  // ada owns it, dee posts in it.
  SPACE_ID: s.space.id,
  MEMBER_ID: s.ids.ada,
  OUTSIDER_ID: s.ids.bea,
  POSTER_ID: s.ids.dee,
  OWNER_TOKEN: ada,
  POSTER_TOKEN: dee,
  CHAPTERS_ID: chapters.channel.id,
  RANDOM_ID: s.channels.random,
  NINE_ID: nine.channel.id,
  NINE_ROOT_ID: root.id,
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

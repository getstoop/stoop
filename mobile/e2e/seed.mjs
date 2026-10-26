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
// holds ada's messages in Markdown, read, and links her messages with
// link previews, read. In photos dee has sent files, read by ada. Book
// club's group readers is ada and dee.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
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

// In formatting, ada's own messages in Markdown, all read by her. First
// the blocks: a quote; a nested bulleted list with a link in a row; a
// numbered list, edited; a code block too long for a line, with marks,
// @here and a link left as written; and a quote with a spoiler filling
// the middle of its line, so a tap there lands on it. Then, newest, every
// inline mark with a link, a channel link to random, @here and dee
// mentioned, emoji among the words; a link whose words hide a spoiler; a
// message that is one spoiler, a line long, so a tap on the middle of the
// message lands on it; and one of only emoji (markdown.yaml).
const formatting = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "formatting", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const blocks = [
  "> Every tree was once a nut\n> that held its ground",
  "Packing list:\n- rope\n  - 60 m\n  - dry treated\n- the [route topo](https://example.com/topo)",
  "1. Warm up\n2. Climb\n  - lead\n3. Stretch",
  "```\n// **left as written** @here https://example.com\n" +
    'const route = { grade: "5.10a", pitches: 3, notes: "traverse left at the second bolt" };\n```',
  "> Who? ||The gardener, with a trowel||",
];
for (const content of blocks) {
  const { message } = await rpc(
    "chat.v1.ChatService/SendMessage",
    { channelId: formatting.channel.id, content },
    ada,
  );
  if (content.startsWith("1.")) {
    await rpc("chat.v1.ChatService/EditMessage", { messageId: message.id, content: `${content}\n4. Eat` }, ada);
  }
}
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

// In links, ada's messages with link previews, fetched by the server
// from a site this seed serves for as long as that takes
// (STOOP_UNFURL_ALLOW_PRIVATE, scripts/mobile-e2e.sh), with previews on
// only meanwhile, so no other message's link is fetched: a page with a
// wide image, under its words, the message then edited; a page with a
// square one, beside them,
// and an image on its own; and, newest, a link to one of formatting's
// messages, whose card ("Stoop", this server's page) the app leaves out
// as web does (link-previews.yaml).
const links = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "links", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const site = await serveSite();
await rpc("instance.v1.InstanceService/UpdateSettings", { linkPreviews: true }, ada);
const linked = [
  `Trail map for Saturday: ${site.url}/trail`,
  `The hut, and a photo of it: ${site.url}/hut ${site.url}/photo.png`,
  `As we said: ${BASE}/s/${s.space.id}/c/${formatting.channel.id}?m=${lastFormatted.id}`,
];
const sentLinked = [];
for (const content of linked) {
  const sent = await rpc("chat.v1.ChatService/SendMessage", { channelId: links.channel.id, content }, ada);
  sentLinked.push(sent.message);
}
const lastLinked = sentLinked.at(-1);
await previewsLanded(links.channel.id, ada, [1, 2, 1]);
// The trail's message edited, its card kept: "(edited)" goes after it.
await rpc(
  "chat.v1.ChatService/EditMessage",
  { messageId: sentLinked[0].id, content: `${linked[0]}, meet at eight` },
  ada,
);
await previewsLanded(links.channel.id, ada, [1, 2, 1]);
site.close();
await rpc("instance.v1.InstanceService/UpdateSettings", { linkPreviews: false }, ada);
await rpc("chat.v1.ChatService/MarkChannelRead", { channelId: links.channel.id, messageId: lastLinked.id }, ada);

// In photos, dee's files, oldest first: a landscape photo and a portrait
// one (sizes the server measures), the two together, a PDF, a short
// H.264 clip, ten seconds of AAC audio, and a photo whose file
// scripts/mobile-e2e.sh then marks expired, as attachment retention
// would (EXPIRE_FILE_ID) (attachments.yaml).
const photos = await rpc(
  "chat.v1.ChatService/CreateChannel",
  { spaceId: s.space.id, name: "photos", kind: "CHANNEL_KIND_TEXT" },
  ada,
);
const media = (name) => new URL(`media/${name}`, import.meta.url);
const sendFiles = async (content, names) => {
  const attachmentIds = [];
  for (const name of names) attachmentIds.push((await upload(photos.channel.id, media(name), dee)).id);
  return (await rpc("chat.v1.ChatService/SendMessage", { channelId: photos.channel.id, content, attachmentIds }, dee))
    .message;
};
await sendFiles("From the ridge", ["ridge-landscape.jpg"]);
await sendFiles("The hut", ["hut-portrait.jpg"]);
await sendFiles("Both", ["ridge-landscape.jpg", "hut-portrait.jpg"]);
await sendFiles("Notes for Saturday", ["trail-notes.pdf"]);
await sendFiles("Up the path", ["ridge-walk.mp4"]);
await sendFiles("The wind up there", ["ridge-wind.m4a"]);
const old = await sendFiles("Last year's map", ["trail-map.jpg"]);
await rpc("chat.v1.ChatService/MarkChannelRead", { channelId: photos.channel.id, messageId: old.id }, ada);

const readers = await rpc(
  "chat.v1.ChatService/CreateGroup",
  { spaceId: s.space.id, handle: "readers", name: "Readers", userIds: [s.ids.ada, s.ids.dee] },
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
  READERS_ID: readers.group.id,
  NINE_ID: nine.channel.id,
  NINE_ROOT_ID: root.id,
  EXPIRE_FILE_ID: old.attachments[0].fileId,
  INVITE_LINK: s.invite.url,
  // What the web's open-in-app page fires for that invite.
  OPEN_LINK: `stoop://open?${new URLSearchParams({ server: BASE, path })}`,
};
for (const [key, value] of Object.entries(env)) console.log(`${key}=${value}`);

// The linked site: two pages with Open Graph tags and their images, and
// an image linked directly.
async function serveSite() {
  const png = (base64) => Buffer.from(base64, "base64");
  // 192×96: blue over green stripes.
  const wide = png(
    "iVBORw0KGgoAAAANSUhEUgAAAMAAAABgCAIAAADEouq+AAAA/0lEQVR42u3SwQ0AEBBFQSW5kyhBJwpQgkqUqQYuQiZ553/YnZDalI4LTiCABJAAEkASQAJIAAkgCSABJIAEkASQABJAAkgCSAAJIAEkgCSABJAAEkASQAJIAAkgCSABJIAEkASQABJAAkgASQAJIAEkgCSABJAAEkASQAJIAAkgCSABJIAEkASQANJFQKXHrerIW9n/ex8g+wDZB8g+QB4AkAPZB8g+QPYB8gCAHMg+QPYBsg+QfYA8wD5A9gGyD5B9gDzAPkD2AbIPkH2APAAgB7IPkH2A7APkAQA5kH2A7ANkHyD7AHmAfYDsA2QfIPsAeYB9gOwDZB8g+8/vL8X0q/wS/v3yAAAAAElFTkSuQmCC",
  );
  // 96×96: an orange and green check.
  const square = png(
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAr0lEQVR42u3bMQ0AIAwEwCpiwA4u2DGLEkx0IJ9LXsD31k/r7tWScWZLfutTgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgCKAUg/r6gMIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQoA8hwaFkFBAgQIECAAAECBAgQIECAAAECBAgQIECAAAHyL2Y4BAQIECBAgAABAgQIECBAgAABAgQIECBAgAABAhQB9AC5zdqki08AGgAAAABJRU5ErkJggg==",
  );
  const pages = {
    "/trail": page("Ridge loop", "A five-mile loop over the ridge, with the hut at the halfway mark.", "/wide.png", "Example Trails"),
    "/hut": page("The hut", "Bunks for twelve, a stove and a view of the valley.", "/square.png"),
  };
  const images = { "/wide.png": wide, "/square.png": square, "/photo.png": square };
  const server = createServer((req, res) => {
    if (images[req.url]) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(images[req.url]);
    } else if (pages[req.url]) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pages[req.url]);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function page(title, description, image, siteName) {
  return `<html><head><title>fallback</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${siteName ? `<meta property="og:site_name" content="${siteName}">` : ""}
<meta property="og:image" content="${image}">
</head><body>${title}</body></html>`;
}

// Waits until the channel's newest messages carry these many previews
// each, in any order: the server fetches them after the send.
async function previewsLanded(channelId, token, counts) {
  for (let tries = 0; tries < 60; tries++) {
    const { messages } = await rpc("chat.v1.ChatService/ListMessages", { channelId, limit: counts.length }, token);
    const have = messages.map((message) => (message.linkPreviews ?? []).length).sort();
    if (JSON.stringify(have) === JSON.stringify([...counts].sort())) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`link previews never landed in ${channelId}`);
}

// POST /files/upload, as the app sends a picked file.
async function upload(channelId, path, token) {
  const name = path.pathname.split("/").at(-1);
  const form = new FormData();
  form.append("channel_id", channelId);
  form.append("file", new Blob([await readFile(path)]), name);
  const res = await fetch(`${BASE}/files/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

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

// A change made from inside a flow, as another device would make it. STEP
// names one of the steps below. The seed's values (SERVER, SPACE_ID,
// OWNER_TOKEN, ...) are in scope as they are in the flow. The JSON is
// built here: Maestro reads ${...} in a flow up to the last brace, so a
// body written there breaks.
// Maestro's script engine is older JavaScript: no template strings or
// arrows, and a reserved word as a key is quoted.
function rpc(proc, token, body) {
  var res = http.post(SERVER + "/stoop.chat.v1.ChatService/" + proc, {
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(proc + ": " + res.status + " " + res.body);
  return JSON.parse(res.body);
}

var steps = {
  // In Book club (space-channels.yaml): ada, its owner, makes CHANNEL_NAME;
  // dee writes in it, then mentions ada there; ada deletes it.
  create: function () {
    output.channelId = rpc("CreateChannel", OWNER_TOKEN, {
      spaceId: SPACE_ID,
      name: CHANNEL_NAME,
      kind: "CHANNEL_KIND_TEXT",
    }).channel.id;
  },
  post: function () {
    rpc("SendMessage", POSTER_TOKEN, { channelId: output.channelId, content: "Fresh from another device" });
  },
  mention: function () {
    rpc("SendMessage", POSTER_TOKEN, {
      channelId: output.channelId,
      content: "<@u:" + MEMBER_ID + ":" + MEMBER + "> over here",
    });
  },
  "delete": function () {
    rpc("DeleteChannel", OWNER_TOKEN, { channelId: output.channelId });
  },
  // In CHANNEL_ID (channel.yaml): dee writes TEXT, rewords that message to
  // TEXT, then deletes it.
  say: function () {
    output.messageId = rpc("SendMessage", POSTER_TOKEN, { channelId: CHANNEL_ID, content: TEXT }).message.id;
  },
  reword: function () {
    rpc("EditMessage", POSTER_TOKEN, { messageId: output.messageId, content: TEXT });
  },
  unsay: function () {
    rpc("DeleteMessage", POSTER_TOKEN, { messageId: output.messageId });
  },
  // In CHANNEL_ID (message-menu.yaml): ada, who owns the space and so
  // moderates it, writes TEXT.
  ownerSays: function () {
    rpc("SendMessage", OWNER_TOKEN, { channelId: CHANNEL_ID, content: TEXT });
  },
  // In CHANNEL_ID (send.yaml): how many of the newest page's messages
  // read TEXT, as the server holds them.
  count: function () {
    var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
    var count = 0;
    for (var i = 0; i < messages.length; i++) if (messages[i].content === TEXT) count++;
    output.count = count;
  },
};

// hasOwnProperty from the prototype, so a STEP like "toString" is unknown.
if (!Object.prototype.hasOwnProperty.call(steps, STEP)) throw new Error("unknown STEP " + STEP);
steps[STEP]();

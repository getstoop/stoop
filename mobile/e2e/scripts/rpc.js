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
  // In CHANNEL_ID (message-menu.yaml, edit.yaml): ada, who owns the space
  // and so moderates it, writes TEXT; or (edit.yaml) TEXT after a mention
  // of dee, as a token.
  ownerSays: function () {
    output.messageId = rpc("SendMessage", OWNER_TOKEN, { channelId: CHANNEL_ID, content: TEXT }).message.id;
  },
  ownerMentions: function () {
    output.messageId = rpc("SendMessage", OWNER_TOKEN, {
      channelId: CHANNEL_ID,
      content: "<@u:" + POSTER_ID + ":" + POSTER + "> " + TEXT,
    }).message.id;
  },
  // Whether the message `ownerSays` or `ownerMentions` wrote now reads
  // EXPECTED, as the server holds it (edit.yaml); what it reads and when
  // it was last edited are left in output.content and output.editedAt.
  contentIs: function () {
    var message = held();
    output.content = message ? message.content : "";
    output.editedAt = message ? message.editedAt || "" : "";
    output.contentIs = output.content === EXPECTED;
  },
  // Whether that message still reads, and was last edited, as contentIs
  // found it: a Save with nothing changed sent nothing (edit.yaml).
  unchangedSince: function () {
    var message = held();
    output.unchangedSince =
      !!message && message.content === output.content && (message.editedAt || "") === output.editedAt;
  },
  // In CHANNEL_ID (send.yaml): how many of the newest page's messages
  // read TEXT, as the server holds them.
  count: function () {
    var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
    var count = 0;
    for (var i = 0; i < messages.length; i++) if (messages[i].content === TEXT) count++;
    output.count = count;
  },
  // In CHANNEL_ID (message-more.yaml): the id of the newest page's message
  // reading TEXT, as the server holds it, for the link the flow expects.
  messageId: function () {
    var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
    output.messageId = "";
    for (var i = 0; i < messages.length; i++) if (messages[i].content === TEXT) output.messageId = messages[i].id;
    if (!output.messageId) throw new Error("no message reads " + TEXT);
  },
  // In CHANNEL_ID (quote-reply.yaml): whether the newest page's message
  // reading TEXT quotes the one reading QUOTED_TEXT, as the server holds
  // them, and that message's id, for ownerUnsays to delete it.
  repliesTo: function () {
    var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
    var quotedId = "";
    var reply = null;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].content === QUOTED_TEXT) quotedId = messages[i].id;
      if (messages[i].content === TEXT) reply = messages[i];
    }
    if (!quotedId) throw new Error("no message reads " + QUOTED_TEXT);
    if (!reply) throw new Error("no message reads " + TEXT);
    output.messageId = reply.id;
    output.repliesTo = !!reply.replyTo && reply.replyTo.messageId === quotedId;
  },
  // In CHANNEL_ID (message-actions.yaml): how many people have given
  // EMOJI to the newest page's message reading TEXT, as the server holds
  // it; -1 when no message reads TEXT. The sheet closes on the tap,
  // before the server has answered, so this asks again for up to five
  // seconds until the count is EXPECTED, and leaves the last count read
  // for the flow to judge.
  reactionCount: function () {
    var deadline = Date.now() + 5000;
    for (;;) {
      var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
      output.reactionCount = -1;
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].content !== TEXT) continue;
        output.reactionCount = 0;
        var reactions = messages[i].reactions || [];
        for (var j = 0; j < reactions.length; j++) {
          if (reactions[j].emoji === EMOJI) output.reactionCount = (reactions[j].userIds || []).length;
        }
      }
      if (String(output.reactionCount) === String(EXPECTED) || Date.now() > deadline) return;
      // The script engine has no timer: a short spin between asks.
      var until = Date.now() + 200;
      while (Date.now() < until) {}
    }
  },
  // The message `say` or `repliesTo` found, deleted by ada, who moderates
  // the space, as if from another device while its author has the confirm
  // open; or ada's own reply, once the flow has seen it.
  ownerUnsays: function () {
    rpc("DeleteMessage", OWNER_TOKEN, { messageId: output.messageId });
  },
  // bea (OUTSIDER_ID) in Book club as an admin, who moderates; already a
  // member when the invite flows ran first. Then back to a plain member,
  // as if demoted while she has a confirm open.
  promote: function () {
    try {
      rpc("AddMember", OWNER_TOKEN, { spaceId: SPACE_ID, userId: OUTSIDER_ID });
    } catch (err) {
      if (String(err).indexOf("already") === -1) throw err;
    }
    rpc("SetMemberRole", OWNER_TOKEN, { spaceId: SPACE_ID, userId: OUTSIDER_ID, role: "SPACE_ROLE_ADMIN" });
  },
  demote: function () {
    rpc("SetMemberRole", OWNER_TOKEN, { spaceId: SPACE_ID, userId: OUTSIDER_ID, role: "SPACE_ROLE_MEMBER" });
  },
};

// The message output.messageId names, from CHANNEL_ID's newest page as
// the server holds it, or null.
function held() {
  var messages = rpc("ListMessages", OWNER_TOKEN, { channelId: CHANNEL_ID, limit: 50 }).messages || [];
  for (var i = 0; i < messages.length; i++) if (messages[i].id === output.messageId) return messages[i];
  return null;
}

// hasOwnProperty from the prototype, so a STEP like "toString" is unknown.
if (!Object.prototype.hasOwnProperty.call(steps, STEP)) throw new Error("unknown STEP " + STEP);
steps[STEP]();

// A change to Book club from inside a flow, as another device would make
// it. STEP says which: "create" makes CHANNEL_NAME as ada, its owner;
// "post" has dee write in it, "mention" has dee mention ada there, and
// "delete" removes it as ada. The seed's values (SERVER, SPACE_ID,
// OWNER_TOKEN, ...) are in scope as they are in the flow. The JSON is
// built here: Maestro reads ${...} in a flow up to the last brace, so a
// body written there breaks.
// Maestro's script engine is older JavaScript: no template strings.
function rpc(proc, token, body) {
  var res = http.post(SERVER + "/stoop.chat.v1.ChatService/" + proc, {
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(proc + ": " + res.status + " " + res.body);
  return JSON.parse(res.body);
}

if (STEP === "create") {
  output.channelId = rpc("CreateChannel", OWNER_TOKEN, {
    spaceId: SPACE_ID,
    name: CHANNEL_NAME,
    kind: "CHANNEL_KIND_TEXT",
  }).channel.id;
} else if (STEP === "post") {
  rpc("SendMessage", POSTER_TOKEN, { channelId: output.channelId, content: "Fresh from another device" });
} else if (STEP === "mention") {
  rpc("SendMessage", POSTER_TOKEN, {
    channelId: output.channelId,
    content: "<@u:" + MEMBER_ID + ":" + MEMBER + "> over here",
  });
} else if (STEP === "delete") {
  rpc("DeleteChannel", OWNER_TOKEN, { channelId: output.channelId });
} else {
  throw new Error("unknown STEP " + STEP);
}

// Seeding the instance over RPC (STOOP-234). Plain JavaScript because it
// was shared with the puppeteer suite; web/e2e/seed.d.mts types it for
// the Playwright specs, which are all that is left.

export const BASE = process.env.STOOP_E2E_BASE_URL ?? "http://localhost:8091";
export const SESSION_COOKIE = "stoop_session";

// Build the instance through the API instead of the browser (STOOP-234).
// Driving the setup wizard and a signup form costs a spec about nine
// seconds before its first assertion; the same state over RPC costs a
// round trip each. Only specs whose subject *is* signing up — setup,
// registration, invites, login-providers — should still use the UI.
async function rpc(proc, body, token) {
  const res = await fetch(`${BASE}/stoop.${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // The auth rate limit (20/min) is real, and a suite seeding a cast per
  // spec clears it in well under a minute. Servers meant for a suite turn
  // it off; back off and retry for the ones that don't.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 5000));
    return rpc(proc, body, token);
  }
  const out = await res.json();
  if (!res.ok) throw new Error(`${proc}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

// Registers the cast (the first account becomes the server admin), makes
// one space owned by the first, renames its default channel and adds the
// rest. Returns the tokens and ids the spec needs, plus the suffix that
// keeps usernames unique across runs.
export async function seed({
  users = ["ada", "bea"],
  space = "Stoop HQ",
  channels = ["general", "random"],
  password = "correct horse battery",
  // Who joins the space. Default is everyone; naming a subset leaves the
  // rest registered but outside it, for a spec that asserts on the member
  // list growing as people arrive.
  members = null,
  // Mint a shareable invite too, for a spec whose subject is arriving
  // through one.
  invite = false,
} = {}) {
  const suffix = String(Date.now() % 1000000);
  const named = users.map((u) => `${u}${suffix}`);
  const tokens = {};
  const ids = {};
  for (const [i, username] of named.entries()) {
    await rpc(
      "auth.v1.AuthService/Register",
      { username, password },
      i === 0 ? undefined : tokens[users[0]],
    );
    const login = await rpc("auth.v1.AuthService/Login", {
      username,
      password,
    });
    tokens[users[i]] = login.token;
    ids[users[i]] = login.user.id;
  }
  const owner = tokens[users[0]];
  const { space: made, defaultChannel } = await rpc(
    "chat.v1.ChatService/CreateSpace",
    { name: space },
    owner,
  );
  const [first, ...rest] = channels;
  const made_channels = { [first]: defaultChannel.id };
  await rpc(
    "chat.v1.ChatService/UpdateChannel",
    { channelId: defaultChannel.id, name: first },
    owner,
  );
  for (const name of rest) {
    const { channel } = await rpc(
      "chat.v1.ChatService/CreateChannel",
      { spaceId: made.id, name, kind: "CHANNEL_KIND_TEXT" },
      owner,
    );
    made_channels[name] = channel.id;
  }
  const joining = (members ?? users).filter((u) => u !== users[0]);
  for (const u of joining) {
    await rpc(
      "chat.v1.ChatService/AddMember",
      { spaceId: made.id, userId: ids[u] },
      owner,
    );
  }
  let link = null;
  if (invite) {
    const { invite: minted } = await rpc(
      "chat.v1.ChatService/CreateInvite",
      { spaceId: made.id },
      owner,
    );
    const url = new URL(`/join/${minted.code}`, BASE);
    url.searchParams.set("space", space);
    link = { code: minted.code, url: url.toString() };
  }
  return {
    suffix,
    tokens,
    ids,
    space: made,
    channels: made_channels,
    password,
    invite: link,
  };
}

// Redeems an invite for an already-registered account. The gateway builds
// a connection's presence snapshot from the spaces its user is in at
// connect time, so a spec that needs someone to *see* who is already
// online has to join before it opens the page, not after.
export async function joinSpace(token, code) {
  return rpc("chat.v1.ChatService/JoinSpace", { code }, token);
}

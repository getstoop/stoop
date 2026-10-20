// Builds the instance the mobile flows sign in to, over RPC, with the
// browser suite's seed, and prints what the flows need as KEY=value lines
// for scripts/mobile-e2e.sh to hand Maestro.
//
// ada is in the space; bea has an account but isn't; cleo has neither and
// arrives through the invite.

import { BASE, seed } from "../../web/e2e/seed.mjs";

const space = "Book club";
const s = await seed({ users: ["ada", "bea"], members: ["ada"], space, invite: true });
const path = new URL(s.invite.url).pathname;

const env = {
  SERVER: BASE,
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

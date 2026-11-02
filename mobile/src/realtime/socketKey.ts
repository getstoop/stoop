import type { SavedServer } from "../api/servers";

// What decides the sockets to hold: one line per server, its ID and origin
// first. Switching servers reorders the list, which changes nothing here;
// a server added or forgotten does, and so does a new sign-in to one (its
// session), so a socket never stays on the account before.
export function socketKey(servers: SavedServer[]): string {
  return servers
    .map((server) => `${server.id} ${server.origin} ${server.session ?? 0}`)
    .sort()
    .join("\n");
}

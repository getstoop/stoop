import type { SavedServer } from "../api/servers";

// A server's ID stays when someone else signs in to it, so what belongs to
// one session (its socket, the server's stack, a channel's log) is keyed on
// this.
export const sessionKey = (server: SavedServer) => `${server.id}/${server.session ?? 0}`;

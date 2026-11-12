// The space the Spaces tab last showed on each server, kept on the
// device alone: a server's local ID to the space's ID. A server with no
// entry opens on its first space.

export type LastSpaces = Readonly<Record<string, string>>;

export const NO_LAST_SPACES: LastSpaces = {};

// The map as it was saved. What can't be understood is empty, and an
// entry that isn't a space's ID is left out, so a partly bad save keeps
// what it can.
export function parseLastSpaces(raw: string | null): LastSpaces {
  if (!raw) return NO_LAST_SPACES;
  try {
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return NO_LAST_SPACES;
    const spaces: Record<string, string> = {};
    for (const [serverId, spaceId] of Object.entries(saved)) {
      if (typeof spaceId === "string" && spaceId !== "") spaces[serverId] = spaceId;
    }
    return spaces;
  } catch {
    return NO_LAST_SPACES;
  }
}

// The same map with a server's space set. The same object when it
// already says so.
export function withSpace(spaces: LastSpaces, serverId: string, spaceId: string): LastSpaces {
  if (spaces[serverId] === spaceId) return spaces;
  return { ...spaces, [serverId]: spaceId };
}

// The same map once a server is gone, so a later one never inherits its
// space. The same object when it had none.
export function withoutServer(spaces: LastSpaces, serverId: string): LastSpaces {
  if (!(serverId in spaces)) return spaces;
  const { [serverId]: _gone, ...rest } = spaces;
  return rest;
}

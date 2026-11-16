// Where a channel and its threads are pushed: a space's channel under its
// space, a direct message (no space) under /dm, as web's /s/… and /dm/…
// paths are. `focus` opens it at a message. A voice room's chat is
// shown by the room's own screen, on its Chat side.

export function channelRoute(serverId: string, spaceId: string, channelId: string, focus?: string) {
  const at = focus ? { focus } : {};
  return spaceId
    ? {
        pathname: "/s/[id]/space/[spaceId]/channel/[channelId]",
        params: { id: serverId, spaceId, channelId, ...at },
      }
    : { pathname: "/s/[id]/dm/[channelId]", params: { id: serverId, channelId, ...at } };
}

export function threadRoute(serverId: string, spaceId: string, channelId: string, rootId: string, focus?: string) {
  const at = focus ? { focus } : {};
  return spaceId
    ? {
        pathname: "/s/[id]/space/[spaceId]/channel/[channelId]/thread/[rootId]",
        params: { id: serverId, spaceId, channelId, rootId, ...at },
      }
    : { pathname: "/s/[id]/dm/[channelId]/thread/[rootId]", params: { id: serverId, channelId, rootId, ...at } };
}

// A voice room; with `focus`, on its Chat side at that message.
export function roomRoute(serverId: string, spaceId: string, channelId: string, focus?: string) {
  const at = focus ? { focus } : {};
  return {
    pathname: "/s/[id]/space/[spaceId]/voice/[channelId]",
    params: { id: serverId, spaceId, channelId, ...at },
  } as const;
}

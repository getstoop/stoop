// The paths a shared link to a channel or a message carries, shared with
// the phone. What makes them links (the server's origin, the clipboard)
// and what a browser does on landing on one stay in web/src/api/shareLinks.ts.

// A space channel, or a direct message when there is no space.
export function channelPath(spaceId: string, channelId: string): string {
  return spaceId ? `/s/${spaceId}/c/${channelId}` : `/dm/${channelId}`;
}

// ?m= opens the channel around that message rather than the newest one.
export function messagePath(
  spaceId: string,
  channelId: string,
  messageId: string,
): string {
  return `${channelPath(spaceId, channelId)}?m=${encodeURIComponent(messageId)}`;
}

// ?t= opens a thread in the side panel; ?m= with it lands on one reply.
export function threadPath(
  spaceId: string,
  channelId: string,
  rootId: string,
  messageId?: string,
): string {
  let query = `t=${encodeURIComponent(rootId)}`;
  if (messageId && messageId !== rootId)
    query += `&m=${encodeURIComponent(messageId)}`;
  return `${channelPath(spaceId, channelId)}?${query}`;
}

// The path Copy link gives a message: the channel opened around it, as
// web's channel list links every row it shows, a reply sent to the
// channel too; for a reply that stays in its thread, the thread opened
// on it, as web's thread view links one.
export function messageLinkPath(
  spaceId: string,
  channelId: string,
  messageId: string,
  threadRootId: string,
  inChannel: boolean,
): string {
  if (threadRootId && threadRootId !== messageId && !inChannel)
    return threadPath(spaceId, channelId, threadRootId, messageId);
  return messagePath(spaceId, channelId, messageId);
}

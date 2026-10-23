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

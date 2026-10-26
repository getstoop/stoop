// The paths a shared link to a channel or a message carries, and the
// message a pasted link leads to, shared with the phone. What makes them
// links (the server's origin, the clipboard) and what a browser does on
// landing on one stay in web/src/api/shareLinks.ts.

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

// The message a link leads to.
export interface LinkedMessage {
  spaceId: string;
  channelId: string;
  messageId: string;
  // Set when the message is a reply in this thread.
  threadRootId: string;
}

// The space-channel message an absolute link names, when the link is to
// one of the given origins (serverOrigins). Null for anything else, a
// direct message's included.
export function linkedMessage(
  href: string,
  origins: string[],
): LinkedMessage | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!origins.includes(url.origin)) return null;
  const seg = url.pathname.split("/").filter((s) => s !== "");
  if (seg.length !== 4 || seg[0] !== "s" || seg[2] !== "c") return null;
  const rootId = url.searchParams.get("t") ?? "";
  const messageId = url.searchParams.get("m") || rootId;
  if (!messageId) return null;
  return {
    spaceId: seg[1],
    channelId: seg[3],
    messageId,
    threadRootId: rootId === messageId ? "" : rootId,
  };
}

// The origins a link to this server may carry: the one the reader reached
// it by, and its configured public address (GetInstanceStatus
// public_url) when it has one.
export function serverOrigins(reached: string, publicUrl?: string): string[] {
  const origins = [reached];
  try {
    if (publicUrl) origins.push(new URL(publicUrl).origin);
  } catch {
    // An address that doesn't parse names no origin.
  }
  return origins;
}

import { normalizeServerUrl } from "../api/probe";

// The place a shared link names, read from what the web's open-in-app
// page hands over (web/src/components/LinkHandoff.tsx):
// stoop://open?server=<origin>&path=<the web's own path>. The paths are
// web's (core/shareLinks, web/src/api/shareLinks.ts), not this app's:
// there /s/<id> is a space, here it is a server.
//
//   /s/<space>                       a space
//   /s/<space>/c/<channel>           a channel
//   /dm/<channel>                    a direct message
//   …?m=<message>                    either, at a message
//   …?t=<root>[&m=<reply>]           a thread in either, at a reply
//
// An empty string where the link has none: a direct message's space, a
// space link's channel, no thread, no message.
export type SharedLink = {
  origin: string;
  spaceId: string;
  channelId: string;
  threadRootId: string;
  messageId: string;
};

// Null for anything else: an invite (pendingInvite.ts holds those),
// the provider sign-in's hand-back (/login, /profile), a path nobody
// shares.
export function sharedLink(server: string, path: string): SharedLink | null {
  const origin = normalizeServerUrl(server);
  if (!origin || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return null;
  }
  const seg = url.pathname.split("/").filter((s) => s !== "");
  const nowhere = { origin, threadRootId: "", messageId: "" };
  if (seg[0] === "s" && seg.length === 2) return { ...nowhere, spaceId: seg[1], channelId: "" };
  let spaceId = "";
  let channelId: string;
  if (seg[0] === "s" && seg.length === 4 && seg[2] === "c") [, spaceId, , channelId] = seg;
  else if (seg[0] === "dm" && seg.length === 2) channelId = seg[1];
  else return null;
  const threadRootId = url.searchParams.get("t") ?? "";
  const messageId = url.searchParams.get("m") ?? "";
  // A thread link to its own root is the thread, at no reply.
  return { origin, spaceId, channelId, threadRootId, messageId: messageId === threadRootId ? "" : messageId };
}

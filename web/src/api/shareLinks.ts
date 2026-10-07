// The links people paste to each other: which paths are shareable, how
// to build one, and how to put one on the clipboard. What a browser does
// when it lands on one is desktopLinks.ts and components/LinkGate.tsx.
// docs/architecture/desktop.md → Deep links.

import type { QueryClient } from "@tanstack/react-query";
import type { GetInstanceStatusResponse } from "../gen/stoop/instance/v1/instance_pb";
import { notice } from "../stores/dialogs";
import { serverOrigin } from "./origin";

// What a shared path leads to, or "" for a path nobody shares. Settings,
// admin and search are not sharing surfaces and never match.
export type SharedLinkKind = "invite" | "message" | "channel" | "space" | "";

// Matches on the path alone: no lookup, nothing fetched, so this can run
// above the route tree before anything has read anything.
export function sharedLinkKind(
  pathname: string,
  search: string,
): SharedLinkKind {
  const seg = pathname.split("/").filter((s) => s !== "");
  const query = new URLSearchParams(search);
  const toMessage = query.has("m") || query.has("t");
  if (seg.length === 2 && seg[0] === "join") return "invite";
  if (seg[0] === "s") {
    if (seg.length === 2) return "space";
    if (seg.length === 4 && seg[2] === "c")
      return toMessage ? "message" : "channel";
  }
  if (seg[0] === "dm" && seg.length === 2)
    return toMessage ? "message" : "channel";
  return "";
}

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

// The search that opens a message where it shows: the channel around it,
// and for a reply in a thread, that thread as well.
export function messageSearch(
  messageId: string,
  threadRootId?: string,
): { m?: string; t?: string } {
  if (!messageId) return {};
  return threadRootId ? { t: threadRootId, m: messageId } : { m: messageId };
}

// ?t= opens a thread in the side panel; ?m= with it lands on one reply.
export function threadPath(
  spaceId: string,
  channelId: string,
  rootId: string,
  messageId?: string,
): string {
  const query = new URLSearchParams({ t: rootId });
  if (messageId && messageId !== rootId) query.set("m", messageId);
  return `${channelPath(spaceId, channelId)}?${query}`;
}

// The thread a link names: its channel from the path, its root from ?t=,
// and the reply to land on from ?m=. Null for a path that isn't a channel.
export function threadFromLink(
  search: URLSearchParams,
  pathname: string,
): Record<string, string> | null {
  const rootId = search.get("t");
  const seg = pathname.split("/").filter((s) => s !== "");
  let spaceId: string;
  let channelId: string;
  if (seg.length === 4 && seg[0] === "s" && seg[2] === "c") {
    [, spaceId, , channelId] = seg;
  } else if (seg.length === 2 && seg[0] === "dm") {
    [spaceId, channelId] = ["", seg[1]];
  } else {
    return null;
  }
  if (!rootId) return null;
  const params: Record<string, string> = { spaceId, channelId, rootId };
  const focusId = search.get("m");
  if (focusId) params.focusId = focusId;
  return params;
}

export function spacePath(spaceId: string): string {
  return `/s/${spaceId}`;
}

// An ordinary https:// link, which is all a shared link ever is. origin
// is the server's configured public address when it has one, so someone
// on the LAN doesn't hand out a link that only works on the LAN.
export function shareUrl(path: string, origin?: string): string {
  return new URL(path, origin || serverOrigin()).toString();
}

// The origin a shared link should carry, read off the cache rather than
// subscribed: a menu item needs it only at the moment it is picked.
export function shareOrigin(queryClient: QueryClient): string {
  const status = queryClient.getQueryData<GetInstanceStatusResponse>([
    "instance-status",
  ]);
  return status?.publicUrl || serverOrigin();
}

// True when the link reached the clipboard. A failure is the only part
// worth saying out loud.
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    notice({ title: "Couldn't copy the link" });
    return false;
  }
}

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
  const toMessage = new URLSearchParams(search).has("m");
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

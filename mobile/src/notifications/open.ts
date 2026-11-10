import { channelRoute, threadRoute } from "../screens/Channel/routes";
import type { NotificationData } from "./content";

// What a tapped notification opens: its data, read back from the
// system as whatever was stored, checked into the payload it was sent
// with (content.ts), and the route that payload names, as an Activity
// row's: its thread at the reply when it has a thread, else its channel
// (a direct message's conversation, which has no space) at the message.

const text = (value: unknown): value is string => typeof value === "string";

// Nothing for data that isn't whole: every field of the payload, with
// the IDs a tap can't do without not empty.
export function notificationData(data: unknown): NotificationData | null {
  if (typeof data !== "object" || data === null) return null;
  const { serverId, itemId, kind, spaceId, channelId, threadRootId, messageId } = data as Record<string, unknown>;
  if (!text(serverId) || !text(itemId) || !text(channelId) || !text(messageId)) return null;
  if (!serverId || !itemId || !channelId || !messageId) return null;
  if (!text(spaceId) || !text(threadRootId) || typeof kind !== "number") return null;
  return { serverId, itemId, kind, spaceId, channelId, threadRootId, messageId };
}

export type NotificationRoute = ReturnType<typeof channelRoute> | ReturnType<typeof threadRoute>;

export function notificationRoute(data: NotificationData): NotificationRoute {
  const { serverId, spaceId, channelId, threadRootId, messageId } = data;
  return threadRootId
    ? threadRoute(serverId, spaceId, channelId, threadRootId, messageId)
    : channelRoute(serverId, spaceId, channelId, messageId);
}

// Where the route's screen is, going by the screen in front (its
// segments and params, as expo-router's useSegments and
// useGlobalSearchParams say them): "here" when it is that screen, so
// nothing is pushed; "under" when the route is a channel and the screen
// in front is one of its threads, so going back reaches it; "elsewhere"
// for a push.
export function placeOf(
  route: NotificationRoute,
  segments: string[],
  params: Record<string, unknown>,
): "here" | "under" | "elsewhere" {
  const same = Object.entries(route.params).every(([key, value]) => key === "focus" || params[key] === value);
  if (!same) return "elsewhere";
  const path = `/${segments.join("/")}`;
  if (path === route.pathname) return "here";
  return path === `${route.pathname}/thread/[rootId]` ? "under" : "elsewhere";
}

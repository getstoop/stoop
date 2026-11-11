import { channelRoute, threadRoute } from "../screens/Channel/routes";
import type { NotificationData } from "./content";

// What a tapped notification opens, and how: the route its data names,
// as an Activity row's (its thread at the reply when it has a thread,
// else its channel, or a direct message's conversation, which has no
// space, at the message), and what the server layout that finds the tap
// waiting does about it (OpenTappedNotification.tsx performs it).

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

// The layout that found the tap: its server, the servers saved, whether
// it is only now mounting (the tap launched the app, or swapped to this
// server), and the screen in front.
export type TapScene = {
  serverId: string;
  saved: string[];
  mounting: boolean;
  segments: string[];
  params: Record<string, unknown>;
};

export type TapAction =
  // A server forgotten since: the tap is let go.
  | { do: "drop" }
  // Another saved server's: swap to it, whose layout then finds the tap.
  | { do: "swap"; serverId: string }
  // This server's. What is in the way is closed first, so the screen
  // doesn't open inside a sheet: whatever the root stack holds over the
  // server (the switcher's sheet, a sign-in), or New message. Then the
  // screen in front goes to the message ("focus"), the app goes back to
  // the channel under its thread ("back"), or the route is pushed.
  | { do: "open"; route: NotificationRoute; close?: "over" | "newMessage"; how: "focus" | "back" | "push" };

// As the layout mounts its stack holds nothing yet, and the screen in
// front may still be said as the one before a swap, so the route is
// pushed without a look at it. What lies under a closed sheet isn't
// looked at either: there the screen is pushed even if it is the one
// beneath.
export function tapAction(tap: NotificationData, scene: TapScene): TapAction {
  if (tap.serverId !== scene.serverId) {
    return scene.saved.includes(tap.serverId) ? { do: "swap", serverId: tap.serverId } : { do: "drop" };
  }
  const route = notificationRoute(tap);
  if (scene.mounting || scene.segments[0] !== "s") return { do: "open", route, close: "over", how: "push" };
  if (scene.segments[2] === "new-message") return { do: "open", route, close: "newMessage", how: "push" };
  const place = placeOf(route, scene.segments, scene.params);
  return { do: "open", route, how: place === "here" ? "focus" : place === "under" ? "back" : "push" };
}

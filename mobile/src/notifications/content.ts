import { activityEntryKey, activityVerb } from "@stoop/core/activity";
import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { PlaceNames } from "./places";

// What a notification says for an activity item, and what it carries
// for whoever opens it.

// The one payload a notification carries, whichever way it arrived:
// where to go when it is tapped. Plain JSON values; an empty string
// where the item has none (a direct message's space, no thread).
export type NotificationData = {
  serverId: string;
  itemId: string;
  kind: ActivityKind;
  spaceId: string;
  channelId: string;
  threadRootId: string;
  messageId: string;
};

export type NotificationContent = {
  identifier: string;
  title: string;
  subtitle: string | undefined;
  body: string;
  data: NotificationData;
};

// The identifier is the entry's key under its server (core
// activityEntryKey): one notification per conversation or thread, each
// new message replacing the last, and a mention or a reply its own. A
// direct message is titled by its sender alone. The subtitle says
// where, nearest first, leaving out what the person can't mistake: the
// server's name only when more than one is saved.
export function notificationContent(
  item: ActivityItem,
  server: { id: string; name: string },
  names: PlaceNames,
  manyServers: boolean,
): NotificationContent {
  const who = item.actor?.displayName || item.actor?.username || "Someone";
  const where = [
    names.channel ? `#${names.channel}` : undefined,
    names.space,
    manyServers ? server.name : undefined,
  ].filter(Boolean);
  return {
    identifier: `${server.id}:${activityEntryKey(item)}`,
    title: item.kind === ActivityKind.DM ? who : `${who} ${activityVerb(item.kind)}`,
    subtitle: where.length > 0 ? where.join(" · ") : undefined,
    body: item.preview,
    data: {
      serverId: server.id,
      itemId: item.id,
      kind: item.kind,
      spaceId: item.spaceId,
      channelId: item.channelId,
      threadRootId: item.threadRootId,
      messageId: item.messageId,
    },
  };
}

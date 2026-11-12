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

const text = (value: unknown): value is string => typeof value === "string";

// The payload read back from the system, which hands over whatever was
// stored: nothing for data that isn't whole, every field present and
// the IDs a tap can't do without not empty.
export function notificationData(data: unknown): NotificationData | null {
  if (typeof data !== "object" || data === null) return null;
  const { serverId, itemId, kind, spaceId, channelId, threadRootId, messageId } = data as Record<string, unknown>;
  if (!text(serverId) || !text(itemId) || !text(channelId) || !text(messageId)) return null;
  if (!serverId || !itemId || !channelId || !messageId) return null;
  if (!text(spaceId) || !text(threadRootId) || typeof kind !== "number") return null;
  return { serverId, itemId, kind, spaceId, channelId, threadRootId, messageId };
}

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
// server's name only when more than one is saved. With the text hidden
// (src/alertPrefs) it names neither who nor what: "Someone mentioned
// you", a direct message just "New direct message", no body; where it
// happened is still said, and the data is what it always is.
export function notificationContent(
  item: ActivityItem,
  server: { id: string; name: string },
  names: PlaceNames,
  { manyServers, showText = true }: { manyServers: boolean; showText?: boolean },
): NotificationContent {
  const who = showText ? item.actor?.displayName || item.actor?.username || "Someone" : "Someone";
  let title = `${who} ${activityVerb(item.kind)}`;
  if (item.kind === ActivityKind.DM) title = showText ? who : "New direct message";
  const where = [
    names.channel ? `#${names.channel}` : undefined,
    names.space,
    manyServers ? server.name : undefined,
  ].filter(Boolean);
  return {
    identifier: `${server.id}:${activityEntryKey(item)}`,
    title,
    subtitle: where.length > 0 ? where.join(" · ") : undefined,
    body: showText ? item.preview : "",
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

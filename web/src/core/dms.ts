import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";

// How a direct message is named, drawn and counted, for web's DM list and
// header and the phone's Messages tab. Web keeps the list in its query
// cache (api/dms.ts); the phone in its own store.

// The other person in a 1:1 DM (the first participant who isn't me).
export function dmOther(
  dm: DirectMessage,
  meId: string | undefined,
): MessageAuthor | undefined {
  return dm.participants.find((p) => p.id !== meId) ?? dm.participants[0];
}

// Everyone but me, in the order the server lists them.
export function dmOthers(
  dm: DirectMessage,
  meId: string | undefined,
): MessageAuthor[] {
  return dm.participants.filter((p) => p.id !== meId);
}

// More than two people. Membership is fixed when the conversation is
// created, so counting is a reliable test. A group has no name of its
// own, so its title and face are made from who is in it.
export function dmIsGroup(dm: DirectMessage): boolean {
  return dm.participants.length > 2;
}

export function personName(p: MessageAuthor | undefined): string {
  return p?.displayName || p?.username || "";
}

export function dmTitle(dm: DirectMessage, meId: string | undefined): string {
  const others = dmOthers(dm, meId);
  if (dmIsGroup(dm)) {
    if (others.length === 0) return "Just you";
    const names = others.slice(0, 2).map(personName);
    const rest = others.length - names.length;
    if (rest === 0) return names.join(" and ");
    if (rest === 1) return `${names.join(", ")} and ${personName(others[2])}`;
    return `${names.join(", ")} and ${rest} others`;
  }
  return personName(dmOther(dm, meId)) || "…";
}

// The one or two faces a conversation shows: the other person, or the
// first two of a group.
export function dmFaces(
  dm: DirectMessage,
  meId: string | undefined,
): MessageAuthor[] {
  if (!dmIsGroup(dm)) {
    const other = dmOther(dm, meId);
    return other ? [other] : [];
  }
  const others = dmOthers(dm, meId);
  return (others.length > 0 ? others : dm.participants).slice(0, 2);
}

// What the rail's DM pill shows: the same numbers the rows do, added up.
// It cannot come from the activity feed — a conversation holds one unread
// entry there however many messages arrive (recordDM refreshes it rather
// than adding rows), so the feed counts conversations while a row counts
// messages, and two identical-looking pills disagree. The predicate is
// the row's own, so the pill is the sum of what you can see.
export function dmUnreadTotal(dms: DirectMessage[] | undefined): number {
  let total = 0;
  for (const dm of dms ?? []) {
    // A closed conversation has no row to open, so it counts for nothing
    // until a message brings it back.
    if (dm.channel && !dm.channel.muted && !dm.closed) {
      total += dm.channel.unreadCount;
    }
  }
  return total;
}

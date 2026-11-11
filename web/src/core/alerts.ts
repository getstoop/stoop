import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";

// Alerts are the messages addressed to the reader past their read
// markers, counted by the server on Channel.alertCount and
// Space.alertCount (docs/architecture/messaging.md → Alert counts). The
// badges show those numbers as given; this file holds what a client adds
// between answers: the one total, and how a live arrival is judged.

// What the desktop shell's dock and tray show for a server, and the
// mobile app's icon, switcher and You tab for one: the alerts over every space, plus one per
// conversation with unread messages. A conversation's alertCount is
// always 0, since everything there is addressed to the reader, so it
// counts once however many messages wait. A muted space or conversation
// counts nothing: the server leaves it out of alertCount, but a mute a
// moment old is still only local until the refetch, as is a closed
// conversation's row.
export function alertingTotal(
  spaces: Space[] | undefined,
  dms: DirectMessage[] | undefined,
): number {
  let total = 0;
  for (const space of spaces ?? []) {
    if (!space.muted) total += space.alertCount;
  }
  for (const dm of dms ?? []) {
    if (dm.channel && !dm.channel.muted && !dm.closed) {
      if (dm.channel.unreadCount > 0) total += 1;
    }
  }
  return total;
}

// Whether a message is addressed to the reader the way the server counts
// alerts: it names them (@channel and @here reach everyone there), or it
// replies to a message of theirs. Their own never is.
export function addressesMe(
  message: Message,
  me: string | null | undefined,
): boolean {
  if (!me || message.author?.id === me) return false;
  return (
    message.mentionUserIds.includes(me) ||
    message.mentionsEntireChannel ||
    message.mentionsHere ||
    message.replyTo?.author?.id === me
  );
}

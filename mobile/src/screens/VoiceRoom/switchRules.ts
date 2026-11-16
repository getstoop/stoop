import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// The rules of a voice room's Call | Chat switch: which side the room
// shows, when Chat wears its dot, and what a screen reader is told of
// each side.

export type Side = "call" | "chat";

// The room opens on Call; opened at a message (a search's row), on Chat.
export const opensOn = (focusId: string | undefined): Side => (focusId ? "chat" : "call");

// Whether Chat wears its dot: the room's chat has messages past the
// reader's marker, as a channel's row says it on the Spaces tab (not
// for a muted room, nor in a muted space), and Chat isn't the side
// being read.
export function chatWaiting(
  channel: Pick<Channel, "unreadCount" | "muted">,
  spaceMuted: boolean,
  side: Side,
): boolean {
  return side === "call" && !channel.muted && !spaceMuted && channel.unreadCount > 0;
}

// What a screen reader is told of a side of the switch.
export function sideLabel(side: Side, marks: { inCall: boolean; waiting: boolean }): string {
  if (side === "call") return marks.inCall ? "Call, you're in it" : "Call";
  return marks.waiting ? "Chat, new messages" : "Chat";
}

// Whether an event could change what waits in the room's chat: a
// message there (one deleted can take an unread with it) or the
// reader's marker moving, from this phone or another.
export function touchesChat(event: ServerEvent, channelId: string): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "messageCreated":
    case "messageDeleted":
    case "channelRead":
      return payload.value.channelId === channelId;
    default:
      return false;
  }
}

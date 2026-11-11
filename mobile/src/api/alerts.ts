import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { chatClient } from "./clients";

// What a server's badges add up: the spaces the account is in, each
// with the server's count of what is addressed to the reader past their
// marker (`alertCount`, `muted`), and its direct messages, each with
// what is unread there. Two lists, asked for together, by the Activity
// and Messages tabs' badges and the app's icon (src/alerts) and by the
// switcher and You for the other servers (useWaiting).

const TIMEOUT_MS = 10000;

export type AlertLists = { spaces: Space[]; dms: DirectMessage[] };

export async function loadAlertLists(origin: string, token: string): Promise<AlertLists> {
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ spaces }, { directMessages }] = await Promise.all([
    chat.listSpaces({}, options),
    chat.listDirectMessages({}, options),
  ]);
  return { spaces, dms: directMessages };
}

// Whether an event could change a badge: a message anywhere (one
// addressed to the reader raises it, the reader's own moves their marker,
// one in a conversation adds to its unread messages; an edit adds or takes away a
// mention, or leaves a placeholder), a marker moving, a mute, a deletion,
// a space or a conversation coming or going, a private channel's readers
// changing (what the reader can read is what is counted). Someone
// leaving a space is rare enough to ask on without knowing whether it
// was the reader. Ready follows a reconnect, when anything may have been
// missed. An activity item is not here: its message already counts.
export function touchesAlerts(event: ServerEvent): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
    case "messageCreated":
    case "messageUpdated":
    case "messageDeleted":
    case "channelRead":
    case "threadRead":
    case "channelMuted":
    case "spaceMuted":
    case "threadMuted":
    case "channelDeleted":
    case "spaceDeleted":
    case "spaceJoined":
    case "memberRemoved":
    case "channelMemberJoined":
    case "channelMemberLeft":
      return true;
    // A conversation opened with the reader; a channel made in a space
    // has nothing addressed to anyone yet.
    case "channelCreated":
      return payload.value.spaceId === "";
    default:
      return false;
  }
}

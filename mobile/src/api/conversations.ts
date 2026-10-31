import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { loadReader, type Reader } from "./activity";
import { chatClient } from "./clients";

// The Messages tab: this account's direct messages on the server, newest
// first as the server lists them, each with its newest message, and who
// is reading (whose own messages say "You", and who is left out of a
// conversation's title). A snapshot, fetched again on pull, on coming
// back to the app and when an event says it changed. How a conversation
// is named and previewed is core/dms.ts, shared with web.

const TIMEOUT_MS = 10000;

export type Conversations = { reader: Reader; dms: DirectMessage[] };

export async function loadConversations(origin: string, token: string): Promise<Conversations> {
  const [{ directMessages }, reader] = await Promise.all([
    chatClient(origin, token).listDirectMessages({}, { timeoutMs: TIMEOUT_MS }),
    loadReader(origin, token),
  ]);
  // A conversation you closed has no row until a message brings it back.
  return { reader, dms: directMessages.filter((dm) => !dm.closed) };
}

// Whether an event could change what the list shows: a conversation's
// newest message, its unread count, its mute, a new one, or the people
// in them (a renamed person, a new avatar). A direct message is a
// channel with no space. Ready follows a reconnect, when anything may
// have been missed.
export function touchesConversations(event: ServerEvent): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
    case "memberUpdated":
      return true;
    case "messageCreated":
    case "messageUpdated":
    case "channelCreated":
    case "messageDeleted":
    case "channelRead":
    case "channelMuted":
      return payload.value.spaceId === "";
    default:
      return false;
  }
}

import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { notice } from "../stores/dialogs";
import { patchRow } from "./channelLog";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// A channel's pins are their own cache entry, fetched when the panel
// opens — the header button doesn't need them. Message.pinned is what the
// timeline marks, and it rides along with the message in the channel log.

export const pinsKey = (channelId: string) => ["pins", channelId];

export function usePins(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: pinsKey(channelId),
    queryFn: async () =>
      (await chatClient.listPinnedMessages({ channelId })).pins,
    enabled,
  });
}

// Flips the flag on the held row, if the channel is held.
export function markPinned(
  channelId: string,
  messageId: string,
  pinned: boolean,
) {
  patchRow(channelId, messageId, (row) => ({ ...row, pinned }));
}

// MessagePinned carries the change, not the list: the log takes the flag
// (channelLog applyEvent); the pin list is dropped so an open panel
// refetches and a closed one doesn't.
export function invalidatePins(queryClient: QueryClient, channelId: string) {
  queryClient.invalidateQueries({ queryKey: pinsKey(channelId) });
}

// The reader's own pin, marked before the server answers; the event that
// follows confirms it at a higher seq.
export async function setMessagePinned(
  queryClient: QueryClient,
  message: Message,
  pinned: boolean,
) {
  markPinned(message.channelId, message.id, pinned);
  try {
    await chatClient.setMessagePinned({ messageId: message.id, pinned });
    invalidatePins(queryClient, message.channelId);
  } catch (err) {
    markPinned(message.channelId, message.id, !pinned);
    notice({
      title: pinned ? "Couldn't pin" : "Couldn't unpin",
      body: errorText(err),
    });
  }
}

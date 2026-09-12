import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { MessagePinned } from "../gen/stoop/realtime/v1/realtime_pb";
import { notice } from "../stores/dialogs";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// A channel's pins are their own cache entry, fetched when the panel
// opens — the header button doesn't need them. Message.pinned is what the
// timeline marks, and it rides along with the message itself.

export const pinsKey = (channelId: string) => ["pins", channelId];

export function usePins(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: pinsKey(channelId),
    queryFn: async () =>
      (await chatClient.listPinnedMessages({ channelId })).pins,
    enabled,
  });
}

// Flip the flag on a message in the timeline window, if it's loaded.
export function markPinned(
  queryClient: QueryClient,
  channelId: string,
  messageId: string,
  pinned: boolean,
) {
  queryClient.setQueryData<Message[]>(["messages", channelId], (old) =>
    old?.map((m) => (m.id === messageId ? { ...m, pinned } : m)),
  );
}

// MessagePinned carries the change, not the list: mark the message, then
// drop the pin list so an open panel refetches and a closed one doesn't.
export function applyPinEvent(queryClient: QueryClient, e: MessagePinned) {
  markPinned(queryClient, e.channelId, e.messageId, e.pinned);
  queryClient.invalidateQueries({ queryKey: pinsKey(e.channelId) });
}

export async function setMessagePinned(
  queryClient: QueryClient,
  message: Message,
  pinned: boolean,
) {
  markPinned(queryClient, message.channelId, message.id, pinned);
  try {
    await chatClient.setMessagePinned({ messageId: message.id, pinned });
    queryClient.invalidateQueries({ queryKey: pinsKey(message.channelId) });
  } catch (err) {
    markPinned(queryClient, message.channelId, message.id, !pinned);
    notice({
      title: pinned ? "Couldn't pin" : "Couldn't unpin",
      body: errorText(err),
    });
  }
}

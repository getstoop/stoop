import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// Whether an event is a new unread activity item about a reply in this
// thread, of any kind: a mention, a quote-reply, a thread_reply or a direct
// message's, and one also sent to the channel, all carry the reply's root.
export function itemInThread(event: ServerEvent, rootId: string): boolean {
  if (event.payload.case !== "activityItemCreated") return false;
  const item = event.payload.value.item;
  return !!item && item.threadRootId === rootId && !item.readAt;
}

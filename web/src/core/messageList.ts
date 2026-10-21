import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Reaction } from "../gen/stoop/chat/v1/reaction_pb";

// How a message, an edit, a deletion or a reaction changes a timeline's
// list of messages, oldest first. Web applies these to every cached
// window of a channel (api/ws.ts); the app to the list it holds.

// The list with message added at the end, or the same list if it is
// already there: the send's reply and the realtime event both deliver it.
export function withMessage(list: Message[], message: Message): Message[] {
  if (list.some((cached) => cached.id === message.id)) return list;
  return [...list, message];
}

// The list with message's new version in place of its old one. Events and
// EditMessage carry only the thread summary's shared half, so the reader's
// own half (participating, muted, unreadCount) is kept.
export function withReplaced(list: Message[], message: Message): Message[] {
  return list.map((cached) =>
    cached.id === message.id ? withViewerHalf(message, cached) : cached,
  );
}

function withViewerHalf(message: Message, cached: Message): Message {
  const next = message.thread;
  const previous = cached.thread;
  if (!next || !previous) return message;
  return {
    ...message,
    thread: {
      ...next,
      participating: previous.participating,
      muted: previous.muted,
      unreadCount: previous.unreadCount,
    },
  };
}

// The list without the message, and with the quote blanked on any reply to
// it (the server does the same on the next fetch). A root really deleted
// (Delete thread) takes its replies, including any also sent to the
// channel.
export function withoutMessage(list: Message[], messageId: string): Message[] {
  return list
    .filter(
      (cached) => cached.id !== messageId && cached.threadRootId !== messageId,
    )
    .map((cached) =>
      cached.replyTo?.messageId === messageId
        ? {
            ...cached,
            replyTo: { ...cached.replyTo, author: undefined, preview: "" },
          }
        : cached,
    );
}

// A root deleted while its thread has replies stays, as a deleted message;
// quotes of it, and the line on its replies also sent to the channel, read
// as a deleted message's.
export function withRootDeleted(list: Message[], rootId: string): Message[] {
  return list.map((cached) => {
    let next = cached;
    if (cached.replyTo?.messageId === rootId) {
      next = {
        ...next,
        replyTo: { ...cached.replyTo, author: undefined, preview: "" },
      };
    }
    if (cached.threadRoot?.messageId === rootId) {
      next = {
        ...next,
        threadRoot: { ...cached.threadRoot, author: undefined, preview: "" },
      };
    }
    return next;
  });
}

// The list with a message's reactions swapped for the server's full list:
// both the RPC reply and ReactionsChanged carry the whole thing, so the
// server's grouping and order always win.
export function withReactions(
  list: Message[],
  messageId: string,
  reactions: Reaction[],
): Message[] {
  return list.map((cached) =>
    cached.id === messageId ? { ...cached, reactions } : cached,
  );
}

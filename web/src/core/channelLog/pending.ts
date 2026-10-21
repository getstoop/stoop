import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import type { ChannelLog } from "./types";

// The reader's own sends awaiting the server (ChannelLog.pending), and
// how one is told apart from the row the server made of it.

// The log without the pending send, or the same log when it isn't there.
export function retired(log: ChannelLog, draftId: string): ChannelLog {
  const pending = log.pending.filter((draft) => draft.id !== draftId);
  return pending.length === log.pending.length ? log : { ...log, pending };
}

// A created row that is a pending send's, arriving before the send's
// answer names its id: the oldest pending row from the same author with
// the same text, thread, quote and number of attachments.
export function retiredMatching(log: ChannelLog, row: Message): ChannelLog {
  const match = log.pending.find((draft) => matchesPending(draft, row));
  return match ? retired(log, match.id) : log;
}

export function matchesPending(draft: Message, row: Message): boolean {
  return (
    !!draft.author &&
    draft.author.id === row.author?.id &&
    draft.content === row.content &&
    draft.threadRootId === row.threadRootId &&
    (draft.replyTo?.messageId ?? "") === (row.replyTo?.messageId ?? "") &&
    draft.attachments.length === row.attachments.length
  );
}

import { create } from "@bufbuild/protobuf";
import {
  type Message,
  MessageSchema,
} from "../../gen/stoop/chat/v1/message_pb";

// A deletion as the log keeps it: the row stays, as a tombstone, so a
// stale copy that arrives later cannot bring the message back.

export type Deletion = {
  id: string;
  channelId: string;
  threadRootId: string;
  seq: bigint;
};

// The held row as a tombstone at the deletion's seq: deleted, no content
// and nothing attached. Made from the event alone when the row was never
// held.
export function tombstoneOf(
  held: Message | undefined,
  deletion: Deletion,
): Message {
  const base =
    held ??
    create(MessageSchema, {
      id: deletion.id,
      channelId: deletion.channelId,
      threadRootId: deletion.threadRootId,
    });
  return {
    ...base,
    deleted: true,
    content: "",
    attachments: [],
    reactions: [],
    linkPreviews: [],
    mentionUserIds: [],
    mentionsEntireChannel: false,
    mentionsHere: false,
    editedAt: undefined,
    seq: deletion.seq,
  };
}

// Rows quoting a deleted message, and replies in the channel answering its
// thread, read as a deleted message's: no author, no preview. The server
// does the same on the next read.
export function withQuotesBlanked(
  rows: ReadonlyMap<string, Message>,
  deletedId: string,
): ReadonlyMap<string, Message> {
  let next: Map<string, Message> | null = null;
  for (const row of rows.values()) {
    let changed = row;
    if (row.replyTo?.messageId === deletedId && named(row.replyTo)) {
      changed = {
        ...changed,
        replyTo: { ...row.replyTo, author: undefined, preview: "" },
      };
    }
    if (row.threadRoot?.messageId === deletedId && named(row.threadRoot)) {
      changed = {
        ...changed,
        threadRoot: { ...row.threadRoot, author: undefined, preview: "" },
      };
    }
    if (changed === row) continue;
    next ??= new Map(rows);
    next.set(row.id, changed);
  }
  return next ?? rows;
}

const named = (ref: { author?: unknown; preview: string }) =>
  !!ref.author || ref.preview !== "";

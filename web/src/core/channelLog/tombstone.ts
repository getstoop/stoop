import { create } from "@bufbuild/protobuf";
import {
  type Message,
  MessageSchema,
} from "../../gen/stoop/chat/v1/message_pb";
import type { MessageDeleted } from "../../gen/stoop/realtime/v1/realtime_pb";
import { withPatch } from "./patch";
import type { ChannelLog } from "./types";

// A deletion as the log keeps it: the row stays, as a tombstone, so a
// stale copy that arrives later cannot bring the message back.

// The held row as a tombstone at the deletion's seq: deleted, no content,
// nothing attached, and no thread summary (the server deletes a root this
// way only once its thread has no live replies; a root deleted while they
// live arrives as an update, a placeholder with its summary). Made from
// the event alone when the row was never held.
export function tombstoneOf(
  held: Message | undefined,
  deletion: MessageDeleted,
): Message {
  const base =
    held ??
    create(MessageSchema, {
      id: deletion.messageId,
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
    thread: undefined,
    seq: deletion.seq,
  };
}

// Rows quoting a deleted message and replies in the channel answering its
// thread read as a deleted message's: no author, no preview. Its pin rows,
// and a poll's closing row, become tombstones at their own seq, since the
// server removes them with it and the message_deleted that follows for
// each replaces them. The server does the same on the next read.
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
    if (
      ROWS_ABOUT.has(row.event?.kind.case) &&
      row.reference?.messageId === deletedId &&
      !row.deleted
    ) {
      changed = { ...changed, deleted: true };
    }
    if (changed === row) continue;
    next ??= new Map(rows);
    next.set(row.id, changed);
  }
  return next ?? rows;
}

// The reader's own delete, answered, before or after its message_deleted:
// the held row as a tombstone at its own seq (a root with a thread
// summary is left to the server's update for it, which fills the
// placeholder in), and the rows about it changed as the event changes
// them, its pin rows and a poll's closing row gone.
export function withOwnDelete(log: ChannelLog, messageId: string): ChannelLog {
  const next = withPatch(log, messageId, (held) =>
    held.deleted || held.thread ? held : { ...held, deleted: true },
  );
  const rows = withQuotesBlanked(next.rows, messageId);
  return rows === next.rows ? next : { ...next, rows };
}

// The kinds of row about a message that go when it goes.
const ROWS_ABOUT: ReadonlySet<string | undefined> = new Set([
  "pin",
  "pollClosed",
]);

const named = (ref: { author?: unknown; preview: string }) =>
  !!ref.author || ref.preview !== "";

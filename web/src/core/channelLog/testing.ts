import { create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  type ListChangesResponse,
  ListChangesResponseSchema,
  type ListMessagesResponse,
  ListMessagesResponseSchema,
} from "../../gen/stoop/chat/v1/chat_pb";
import {
  type Message,
  MessageAuthorSchema,
  MessageSchema,
} from "../../gen/stoop/chat/v1/message_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../../gen/stoop/realtime/v1/realtime_pb";
import { opened } from "./pages";
import { type ChannelLog, emptyLog } from "./types";
import { viewOf } from "./views";

// Fixtures for the channel log's tests: rows by id (UUIDv7 stands in for
// a zero-padded counter), pages and events.

export const CHANNEL = "c1";

const them = create(MessageAuthorSchema, { id: "them" });

export const id = (index: number) => `m${String(index).padStart(5, "0")}`;

export const message = (
  rowId: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, {
    channelId: CHANNEL,
    content: rowId,
    inChannel: true,
    seq: 1n,
    author: them,
    ...init,
    id: rowId,
  });

// Rows id(from) … id(to - 1), each at its own seq counting up from seqFrom.
export const rows = (from: number, to: number, seqFrom = 1): Message[] =>
  Array.from({ length: to - from }, (_, offset) =>
    message(id(from + offset), { seq: BigInt(seqFrom + offset) }),
  );

export const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

export type Edges = {
  hasOlder?: boolean;
  hasNewer?: boolean;
  channelSeq?: number;
  floor?: string;
};

export const page = (
  messages: Message[],
  edges: Edges = {},
): ListMessagesResponse =>
  create(ListMessagesResponseSchema, {
    messages,
    hasOlder: edges.hasOlder ?? true,
    hasNewer: edges.hasNewer ?? false,
    channelSeq: BigInt(edges.channelSeq ?? 0),
    retentionFloorId: edges.floor ?? "",
  });

export const changes = (
  messages: Message[],
  more: { hasMore?: boolean; channelSeq?: number; floor?: string } = {},
): ListChangesResponse =>
  create(ListChangesResponseSchema, {
    messages,
    hasMore: more.hasMore ?? false,
    channelSeq: BigInt(more.channelSeq ?? 0),
    retentionFloorId: more.floor ?? "",
  });

// A log whose channel view is the page given: by default the newest page,
// at the highest seq among its rows.
export const openedOn = (messages: Message[], edges: Edges = {}): ChannelLog =>
  opened(emptyLog(CHANNEL), {
    generation: 0,
    res: page(messages, { channelSeq: topSeq(messages), ...edges }),
  });

// The log with a thread opened on its replies.
export const openedThread = (
  log: ChannelLog,
  rootId: string,
  messages: Message[],
  edges: Edges = {},
): ChannelLog =>
  opened(log, {
    rootId,
    generation: viewOf(log, rootId)?.generation ?? 0,
    res: page(messages, { hasOlder: false, ...edges }),
  });

export const topSeq = (messages: Message[]) =>
  messages.reduce((top, row) => Math.max(top, Number(row.seq)), 0);

export const ids = (messages: Message[]) => messages.map((row) => row.id);

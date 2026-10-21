import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { Mock } from "vitest";
import { isShown, showsInChannel } from "../core/channelLog";
import {
  type ListChangesRequest,
  ListChangesResponseSchema,
  type ListMessagesRequest,
  ListMessagesResponseSchema,
} from "../gen/stoop/chat/v1/chat_pb";
import {
  type Message,
  MessageAuthorSchema,
  MessageSchema,
} from "../gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import { applyEvent } from "./channelLog";
import { useChannelLogStore } from "./channelLogStore";

// A fake server for the channel log loader's tests: a channel log with a
// seq stamped on every write, pages that read the seq before the rows (as
// on the wire), and changes since a seq. Answers are fixed when the request
// is made and may be held, so an event can land in between. The test file
// mocks ./clients and hands the mocks to resetServer.

export const CHANNEL = "general";
export const TOTAL = 400;

const them = create(MessageAuthorSchema, { id: "them" });

export const id = (index: number) => `m${String(index).padStart(4, "0")}`;

export const server = {
  rows: [] as Message[],
  seq: 0,
  floor: "",
  // The most rows a ListChanges page carries.
  changesPage: 200,
  // Requests held for an answer, oldest first.
  held: [] as (() => void)[],
  holding: false,
};

type PageReq = Partial<
  Pick<
    ListMessagesRequest,
    "threadId" | "beforeId" | "afterId" | "aroundId" | "limit"
  >
>;

export function read(req: PageReq) {
  const channelSeq = BigInt(server.seq);
  const rows = server.rows
    .filter(isShown)
    .filter((row) =>
      req.threadId ? row.threadRootId === req.threadId : showsInChannel(row),
    )
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  const limit = req.limit || 50;
  let start: number;
  let end: number;
  if (req.beforeId) {
    end = rows.findIndex((row) => row.id >= (req.beforeId ?? ""));
    if (end < 0) end = rows.length;
    start = Math.max(0, end - limit);
  } else if (req.afterId) {
    start = rows.findIndex((row) => row.id > (req.afterId ?? ""));
    if (start < 0) start = rows.length;
    end = Math.min(rows.length, start + limit);
  } else if (req.aroundId) {
    const at = rows.findIndex((row) => row.id === req.aroundId);
    start = Math.max(0, at - limit / 2);
    end = Math.min(rows.length, start + limit);
  } else {
    end = rows.length;
    start = Math.max(0, end - limit);
  }
  return create(ListMessagesResponseSchema, {
    messages: rows.slice(start, end),
    hasOlder: start > 0,
    hasNewer: end < rows.length,
    channelSeq,
    retentionFloorId: server.floor,
  });
}

export function changes(req: Pick<ListChangesRequest, "sinceSeq" | "limit">) {
  const channelSeq = BigInt(server.seq);
  const since = Number(req.sinceSeq);
  const rows = server.rows
    .filter((row) => Number(row.seq) > since)
    .sort((left, right) => Number(left.seq) - Number(right.seq));
  const limit = Math.min(req.limit || 100, server.changesPage);
  return create(ListChangesResponseSchema, {
    messages: rows.slice(0, limit),
    hasMore: rows.length > limit,
    channelSeq,
    retentionFloorId: server.floor,
  });
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Answers the oldest request held, or the newest.
export async function answer(which: "oldest" | "newest" = "oldest") {
  (which === "oldest" ? server.held.shift() : server.held.pop())?.();
  await settle();
}

// Ids for rows posted after the seeded ones, sorting after them.
export const next = (offset: number) => id(TOTAL + offset);

export const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
) => create(ServerEventSchema, { payload });

// A write: the row at the channel's next seq.
function stamped(row: Message): Message {
  server.seq += 1;
  const written = { ...row, seq: BigInt(server.seq) };
  server.rows = [...server.rows.filter((held) => held.id !== row.id), written];
  return written;
}

// The server takes a message; the socket says so unless told to keep
// quiet (a missed event).
export function postOnServer(
  messageId: string,
  init: MessageInitShape<typeof MessageSchema> = {},
  announce = true,
): Message {
  const row = stamped(
    create(MessageSchema, {
      channelId: CHANNEL,
      content: messageId,
      inChannel: true,
      author: them,
      ...init,
      id: messageId,
    }),
  );
  if (announce) applyEvent(event({ case: "messageCreated", value: row }));
  return row;
}

export function editOnServer(
  messageId: string,
  content: string,
  announce = true,
) {
  const held = server.rows.find((row) => row.id === messageId);
  if (!held) throw new Error(`no row ${messageId}`);
  const row = stamped({ ...held, content });
  if (announce) applyEvent(event({ case: "messageUpdated", value: row }));
}

export function deleteOnServer(messageId: string, announce = true) {
  const held = server.rows.find((row) => row.id === messageId);
  if (!held) throw new Error(`no row ${messageId}`);
  const row = stamped({
    ...held,
    deleted: true,
    content: "",
    attachments: [],
    reactions: [],
  });
  if (announce)
    applyEvent(
      event({
        case: "messageDeleted",
        value: {
          channelId: CHANNEL,
          messageId,
          threadRootId: row.threadRootId,
          seq: row.seq,
        },
      }),
    );
}

export function pinOnServer(messageId: string, announce = true) {
  const held = server.rows.find((row) => row.id === messageId);
  if (!held) throw new Error(`no row ${messageId}`);
  const row = stamped({ ...held, pinned: true });
  if (announce)
    applyEvent(
      event({
        case: "messagePinned",
        value: { channelId: CHANNEL, messageId, pinned: true, seq: row.seq },
      }),
    );
}

// The retention sweep: rows below the floor go, pinned roots and their
// threads excepted.
export function sweepOnServer(floorId: string) {
  server.floor = floorId;
  const pinnedRoots = new Set(
    server.rows.filter((row) => row.pinned).map((row) => row.id),
  );
  server.rows = server.rows.filter((row) => {
    const rootId = row.threadRootId || row.id;
    return rootId >= floorId || pinnedRoots.has(rootId);
  });
}

export const logOf = () => useChannelLogStore.getState().logs[CHANNEL];

export function resetServer(listMessages: Mock, listChanges: Mock) {
  server.rows = [];
  server.seq = 0;
  server.floor = "";
  server.changesPage = 200;
  server.held = [];
  server.holding = false;
  for (let index = 0; index < TOTAL; index++) {
    stamped(
      create(MessageSchema, {
        id: id(index),
        channelId: CHANNEL,
        content: `message ${index}`,
        inChannel: true,
        author: them,
      }),
    );
  }
  useChannelLogStore.setState({ logs: {}, status: {} });
  useConnectionStore.setState({ status: "connected" });
  const answering =
    <T>(reply: (req: never) => T) =>
    (req: never) => {
      const res = reply(req);
      if (!server.holding) return Promise.resolve(res);
      return new Promise((resolve) => server.held.push(() => resolve(res)));
    };
  listMessages.mockReset();
  listMessages.mockImplementation(answering(read));
  listChanges.mockReset();
  listChanges.mockImplementation(answering(changes));
}

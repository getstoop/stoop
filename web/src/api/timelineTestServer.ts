import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import type { Mock } from "vitest";
import { ListMessagesResponseSchema } from "../gen/stoop/chat/v1/chat_pb";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  applyTimelineEvent,
  type Timeline,
  timelineId,
  timelineKey,
  useHistoryStore,
} from "./history";
import { messagesQuery } from "./queries";

// A fake server for the tests of web's timeline windows
// (timelineLoads.test.ts, timelineCache.test.ts) that answers when told:
// what it read is fixed when the request is made, as on the wire, so an
// event can land between the read and the answer. Each test file mocks
// ./clients with a listMessages it hands to resetServer.

export const CHANNEL = "general";
export const TOTAL = 400;

export const id = (i: number) => `m${String(i).padStart(4, "0")}`;
export const server = {
  channel: [] as Message[],
  replies: [] as Message[],
  // Requests held for an answer, oldest first.
  held: [] as (() => void)[],
  holding: false,
};

export type Req = {
  threadId?: string;
  beforeId?: string;
  afterId?: string;
  aroundId?: string;
  limit?: number;
};

export function read(req: Req) {
  const rows = req.threadId ? server.replies : server.channel;
  const limit = req.limit || 50;
  let start: number;
  let end: number;
  if (req.beforeId) {
    end = rows.findIndex((m) => m.id === req.beforeId);
    start = Math.max(0, end - limit);
  } else if (req.afterId) {
    start = rows.findIndex((m) => m.id > (req.afterId ?? ""));
    if (start < 0) start = rows.length;
    end = Math.min(rows.length, start + limit);
  } else if (req.aroundId) {
    const at = rows.findIndex((m) => m.id === req.aroundId);
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
  });
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// Answers the oldest request held.
export async function answer() {
  server.held.shift()?.();
  await settle();
}

export const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
) => create(ServerEventSchema, { payload });

// The server deletes a message and the socket says so.
export function deleteOnServer(queryClient: QueryClient, messageId: string) {
  server.channel = server.channel.filter((m) => m.id !== messageId);
  applyTimelineEvent(
    queryClient,
    event({
      case: "messageDeleted",
      value: { channelId: CHANNEL, messageId },
    }),
  );
}

export function editOnServer(
  queryClient: QueryClient,
  messageId: string,
  content: string,
  announce = true,
) {
  server.channel = server.channel.map((m) =>
    m.id === messageId ? { ...m, content } : m,
  );
  const edited = server.channel.find((m) => m.id === messageId);
  if (announce && edited)
    applyTimelineEvent(
      queryClient,
      event({ case: "messageUpdated", value: edited }),
    );
}

export function postOnServer(queryClient: QueryClient, messageId: string) {
  const message = create(MessageSchema, {
    id: messageId,
    channelId: CHANNEL,
    content: messageId,
  });
  server.channel = [...server.channel, message];
  applyTimelineEvent(
    queryClient,
    event({ case: "messageCreated", value: message }),
  );
}

export const T: Timeline = { channelId: CHANNEL };
export const windowOf = (queryClient: QueryClient, t: Timeline = T) =>
  queryClient.getQueryData<Message[]>(timelineKey(t)) ?? [];
export const ids = (queryClient: QueryClient, t: Timeline = T) =>
  windowOf(queryClient, t).map((m) => m.id);
export const historyOf = (t: Timeline = T) =>
  useHistoryStore.getState().channels[timelineId(t)];

export async function opened(t: Timeline = T) {
  const queryClient = new QueryClient();
  await queryClient.fetchQuery(messagesQuery(t));
  return queryClient;
}

export function resetServer(listMessages: Mock) {
  server.channel = Array.from({ length: TOTAL }, (_, i) =>
    create(MessageSchema, {
      id: id(i),
      channelId: CHANNEL,
      content: `message ${i}`,
    }),
  );
  server.replies = [];
  server.held = [];
  server.holding = false;
  useHistoryStore.setState({ channels: {}, windows: {} });
  listMessages.mockReset();
  listMessages.mockImplementation((req: Req) => {
    const res = read(req);
    if (!server.holding) return Promise.resolve(res);
    return new Promise((resolve) => server.held.push(() => resolve(res)));
  });
}

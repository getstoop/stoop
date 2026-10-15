import { create, toBinary } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Message,
  MessageSchema,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import { replaceMessage, startRealtime } from "./ws";

// The RPC clients and the page's origin are not there in node; these
// tests never reach them.
vi.mock("./clients", () => ({ chatClient: {}, voiceClient: {} }));
vi.mock("./origin", () => ({
  socketUrl: (path: string) => `ws://test${path}`,
}));

const CHANNEL = "general";

// A root as ListMessages gave it: the reader's own half filled in.
const cachedRoot = (): Message =>
  create(MessageSchema, {
    id: "root",
    channelId: CHANNEL,
    content: "before",
    thread: create(ThreadSummarySchema, {
      replyCount: 4,
      participating: true,
      muted: true,
      unreadCount: 3,
    }),
  });

// The same root from an event or EditMessage: the shared half only.
const updatedRoot = (): Message =>
  create(MessageSchema, {
    id: "root",
    channelId: CHANNEL,
    content: "after",
    thread: create(ThreadSummarySchema, { replyCount: 5 }),
  });

function cacheWith(message: Message) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["messages", CHANNEL], [message]);
  queryClient.setQueryData(["messages", CHANNEL, "root"], [message]);
  return queryClient;
}

const readAll = (queryClient: QueryClient) =>
  queryClient
    .getQueriesData<Message[]>({ queryKey: ["messages", CHANNEL] })
    .map(([, messages]) => messages?.[0]);

describe("replaceMessage", () => {
  it("keeps the reader's half of the thread summary", () => {
    const queryClient = cacheWith(cachedRoot());
    replaceMessage(queryClient, updatedRoot());
    for (const message of readAll(queryClient)) {
      expect(message?.content).toBe("after");
      expect(message?.thread).toMatchObject({
        replyCount: 5,
        participating: true,
        muted: true,
        unreadCount: 3,
      });
    }
  });
});

class FakeSocket {
  static last: FakeSocket | undefined;
  binaryType = "";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  close() {}
  send() {}
}

function receiveUpdate(queryClient: QueryClient, message: Message) {
  vi.stubGlobal("WebSocket", FakeSocket);
  const stop = startRealtime(queryClient);
  const frame = toBinary(
    ServerEventSchema,
    create(ServerEventSchema, {
      payload: { case: "messageUpdated", value: message },
    }),
  );
  FakeSocket.last?.onmessage?.({ data: frame.slice().buffer });
  stop();
}

describe("messageUpdated", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the reader's half of a root's thread summary", () => {
    const queryClient = cacheWith(cachedRoot());
    receiveUpdate(queryClient, updatedRoot());
    for (const message of readAll(queryClient)) {
      expect(message?.content).toBe("after");
      expect(message?.thread).toMatchObject({
        replyCount: 5,
        participating: true,
        muted: true,
        unreadCount: 3,
      });
    }
  });

  it("blanks quotes of a root kept as a deleted placeholder", () => {
    const queryClient = new QueryClient();
    const reply = create(MessageSchema, {
      id: "reply",
      channelId: CHANNEL,
      replyTo: { messageId: "root", preview: "before" },
    });
    queryClient.setQueryData(["messages", CHANNEL], [cachedRoot(), reply]);
    const deleted = updatedRoot();
    deleted.deleted = true;
    receiveUpdate(queryClient, deleted);
    const [root, quoting] =
      queryClient.getQueryData<Message[]>(["messages", CHANNEL]) ?? [];
    expect(root?.deleted).toBe(true);
    expect(root?.thread?.muted).toBe(true);
    expect(quoting?.replyTo?.preview).toBe("");
  });
});

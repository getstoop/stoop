import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListMessagesResponseSchema } from "../gen/stoop/chat/v1/chat_pb";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  applyTimelineEvent,
  isLive,
  reconnected,
  type Timeline,
  timelineId,
  timelineKey,
  useHistoryStore,
  WINDOW_CAP,
} from "./history";
import { messagesQuery } from "./queries";
import { jumpTo, jumpToLatest, loadNewer, loadOlder } from "./timelineLoads";

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }));
vi.mock("./clients", () => ({ chatClient: { listMessages } }));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

// The requests that fill a window, against a server that answers when
// told: what it read is fixed when the request is made, as on the wire,
// so an event can land between the read and the answer.

const CHANNEL = "general";
const TOTAL = 400;

const id = (i: number) => `m${String(i).padStart(4, "0")}`;
let channel: Message[] = [];
let replies: Message[] = [];

type Req = {
  threadId?: string;
  beforeId?: string;
  afterId?: string;
  aroundId?: string;
  limit?: number;
};

function read(req: Req) {
  const rows = req.threadId ? replies : channel;
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

// Requests held for an answer, oldest first.
let held: (() => void)[] = [];
let holding = false;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// Answers the oldest request held.
async function answer() {
  held.shift()?.();
  await settle();
}

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
) => create(ServerEventSchema, { payload });

// The server deletes a message and the socket says so.
function deleteOnServer(queryClient: QueryClient, messageId: string) {
  channel = channel.filter((m) => m.id !== messageId);
  applyTimelineEvent(
    queryClient,
    event({
      case: "messageDeleted",
      value: { channelId: CHANNEL, messageId },
    }),
  );
}

function editOnServer(
  queryClient: QueryClient,
  messageId: string,
  content: string,
  announce = true,
) {
  channel = channel.map((m) => (m.id === messageId ? { ...m, content } : m));
  const edited = channel.find((m) => m.id === messageId);
  if (announce && edited)
    applyTimelineEvent(
      queryClient,
      event({ case: "messageUpdated", value: edited }),
    );
}

function postOnServer(queryClient: QueryClient, messageId: string) {
  const message = create(MessageSchema, {
    id: messageId,
    channelId: CHANNEL,
    content: messageId,
  });
  channel = [...channel, message];
  applyTimelineEvent(
    queryClient,
    event({ case: "messageCreated", value: message }),
  );
}

const T: Timeline = { channelId: CHANNEL };
const windowOf = (queryClient: QueryClient, t: Timeline = T) =>
  queryClient.getQueryData<Message[]>(timelineKey(t)) ?? [];
const ids = (queryClient: QueryClient, t: Timeline = T) =>
  windowOf(queryClient, t).map((m) => m.id);
const historyOf = (t: Timeline = T) =>
  useHistoryStore.getState().channels[timelineId(t)];

async function opened(t: Timeline = T) {
  const queryClient = new QueryClient();
  await queryClient.fetchQuery(messagesQuery(t));
  return queryClient;
}

beforeEach(() => {
  channel = Array.from({ length: TOTAL }, (_, i) =>
    create(MessageSchema, {
      id: id(i),
      channelId: CHANNEL,
      content: `message ${i}`,
    }),
  );
  replies = [];
  held = [];
  holding = false;
  useHistoryStore.setState({ channels: {}, windows: {} });
  listMessages.mockReset();
  listMessages.mockImplementation((req: Req) => {
    const res = read(req);
    if (!holding) return Promise.resolve(res);
    return new Promise((resolve) => held.push(() => resolve(res)));
  });
});

describe("an event during a page", () => {
  it("keeps a message deleted while the older page was out", async () => {
    const queryClient = await opened();
    holding = true;
    const paging = loadOlder(queryClient, T);
    deleteOnServer(queryClient, id(320));
    await answer();
    await paging;
    expect(ids(queryClient)).toHaveLength(99);
    expect(ids(queryClient)).not.toContain(id(320));
  });

  it("keeps an edit made while the older page was out", async () => {
    const queryClient = await opened();
    holding = true;
    const paging = loadOlder(queryClient, T);
    editOnServer(queryClient, id(320), "reworded");
    await answer();
    await paging;
    const edited = windowOf(queryClient).find((m) => m.id === id(320));
    expect(edited?.content).toBe("reworded");
  });

  it("keeps an edit made while the newer page was out", async () => {
    const queryClient = await opened();
    await jumpTo(queryClient, T, id(100));
    expect(isLive(historyOf())).toBe(false);
    holding = true;
    const paging = loadNewer(queryClient, T);
    editOnServer(queryClient, id(130), "reworded");
    deleteOnServer(queryClient, id(131));
    await answer();
    await paging;
    const window = windowOf(queryClient);
    expect(window.find((m) => m.id === id(130))?.content).toBe("reworded");
    expect(window.some((m) => m.id === id(131))).toBe(false);
  });

  it("keeps a deletion made while a jump was out", async () => {
    const queryClient = await opened();
    holding = true;
    const jumping = jumpTo(queryClient, T, id(100));
    deleteOnServer(queryClient, id(101));
    await answer();
    expect((await jumping).found).toBe(true);
    expect(ids(queryClient)).toContain(id(100));
    expect(ids(queryClient)).not.toContain(id(101));
  });
});

describe("a reconnect during a page", () => {
  it("drops the page it may have outdated and asks again", async () => {
    const queryClient = await opened();
    holding = true;
    const paging = loadOlder(queryClient, T);
    // While the socket was down: an edit nobody heard about.
    editOnServer(queryClient, id(320), "while away", false);
    // Ready: the catch-up goes, and lands before the page does.
    reconnected();
    const caughtUp = queryClient.refetchQueries({ queryKey: timelineKey(T) });
    held.pop()?.();
    await caughtUp;
    await answer();
    // The page went again, from what is held now.
    expect(held).toHaveLength(1);
    await answer();
    await paging;
    const window = windowOf(queryClient);
    expect(window).toHaveLength(100);
    expect(window.find((m) => m.id === id(320))?.content).toBe("while away");
  });

  it("keeps a page out during a refresh that isn't one", async () => {
    const queryClient = await opened();
    holding = true;
    const paging = loadOlder(queryClient, T);
    const refreshed = queryClient.refetchQueries({ queryKey: timelineKey(T) });
    held.pop()?.();
    await refreshed;
    await answer();
    await paging;
    expect(held).toHaveLength(0);
    expect(ids(queryClient)).toHaveLength(100);
  });
});

describe("a window in history", () => {
  it("counts arrivals on the pill, and the newest page takes them in", async () => {
    const queryClient = await opened();
    const { found } = await jumpTo(queryClient, T, id(100));
    expect(found).toBe(true);
    expect(historyOf()?.landOn).toEqual({ id: id(100) });
    postOnServer(queryClient, "m9000");
    expect(ids(queryClient)).not.toContain("m9000");
    expect(historyOf()?.pendingNewer).toBe(1);
    await jumpToLatest(queryClient, T);
    expect(ids(queryClient).at(-1)).toBe("m9000");
    expect(historyOf()).toMatchObject({
      hasNewer: false,
      pendingNewer: 0,
      landOn: "bottom",
    });
  });

  it("is capped, and stops being live when the newest end goes", async () => {
    const queryClient = await opened();
    for (let page = 0; page < 6; page++) await loadOlder(queryClient, T);
    expect(ids(queryClient)).toHaveLength(WINDOW_CAP);
    expect(ids(queryClient)[0]).toBe(id(50));
    expect(isLive(historyOf())).toBe(false);
  });
});

describe("a thread's window", () => {
  it("opens on its first replies when the root is the target", async () => {
    const thread: Timeline = { channelId: CHANNEL, rootId: "root" };
    replies = ["r1", "r2", "r3"].map((reply) =>
      create(MessageSchema, {
        id: reply,
        channelId: CHANNEL,
        threadRootId: "root",
      }),
    );
    const queryClient = await opened(thread);
    applyTimelineEvent(
      queryClient,
      event({
        case: "messageCreated",
        value: create(MessageSchema, {
          id: "r4",
          channelId: CHANNEL,
          threadRootId: "root",
        }),
      }),
    );
    expect(ids(queryClient, thread)).toEqual(["r1", "r2", "r3", "r4"]);
    await jumpTo(queryClient, thread, "root");
    expect(historyOf(thread)).toMatchObject({
      hasOlder: false,
      landOn: { id: "root" },
    });
    applyTimelineEvent(
      queryClient,
      event({
        case: "messageDeleted",
        value: { channelId: CHANNEL, messageId: "root" },
      }),
    );
    expect(queryClient.getQueryData(timelineKey(thread))).toBeUndefined();
    expect(historyOf(thread)).toBeUndefined();
  });
});

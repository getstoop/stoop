import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { ReactionSchema } from "../gen/stoop/chat/v1/reaction_pb";
import {
  applyTimelineEvent,
  type Timeline,
  timelineKey,
  useHistoryStore,
} from "./history";
import { markPinned } from "./pins";
import { messagesQuery } from "./queries";
import { setReactions } from "./reactions";
import { jumpTo, jumpToLatest, loadOlder } from "./timelineLoads";
import {
  answer,
  CHANNEL,
  event,
  historyOf,
  id,
  ids,
  opened,
  resetServer,
  server,
  T,
  windowOf,
} from "./timelineTestServer";
import { appendMessage, removeMessageFromCache, replaceMessage } from "./ws";

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }));
vi.mock("./clients", () => ({
  chatClient: { listMessages },
  voiceClient: {},
  authClient: {},
}));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

// How a window's reducer state and the query cache stay together: what
// the cache lets go of, the reader's own writes, and writes that still go
// to the cache alone.

beforeEach(() => resetServer(listMessages));

const stored = (t: Timeline = T) =>
  useHistoryStore.getState().windows[
    t.rootId ? `${t.channelId}/${t.rootId}` : t.channelId
  ];

describe("what the cache lets go of", () => {
  it("takes the window's state with it, and a remount opens afresh", async () => {
    const queryClient = await opened();
    await jumpTo(queryClient, T, id(100));
    queryClient.removeQueries({ queryKey: timelineKey(T), exact: true });
    expect(stored()).toBeUndefined();
    expect(historyOf()).toBeUndefined();
    await queryClient.fetchQuery(messagesQuery(T));
    expect(ids(queryClient).at(-1)).toBe(id(399));
    expect(historyOf()?.hasNewer).toBe(false);
  });

  it("forgets every window when the cache is cleared", async () => {
    const queryClient = await opened();
    expect(stored()).toBeDefined();
    queryClient.clear();
    expect(useHistoryStore.getState().windows).toEqual({});
    expect(useHistoryStore.getState().channels).toEqual({});
  });

  it("drops the channel's window and its state when the channel goes", async () => {
    const queryClient = await opened();
    applyTimelineEvent(
      queryClient,
      event({ case: "channelDeleted", value: { channelId: CHANNEL } }),
    );
    expect(queryClient.getQueryData(timelineKey(T))).toBeUndefined();
    expect(stored()).toBeUndefined();
  });
});

describe("the reader's own writes", () => {
  it("keeps their edit and their deletion over a page that was out", async () => {
    const queryClient = await opened();
    server.holding = true;
    const paging = loadOlder(queryClient, T);
    const edited = server.channel[320];
    replaceMessage(queryClient, { ...edited, content: "mine, reworded" });
    removeMessageFromCache(queryClient, CHANNEL, id(321));
    await answer();
    await paging;
    const window = windowOf(queryClient);
    expect(window.find((m) => m.id === id(320))?.content).toBe(
      "mine, reworded",
    );
    expect(window.some((m) => m.id === id(321))).toBe(false);
  });

  it("takes a deleted root's thread window and its state", async () => {
    const thread: Timeline = { channelId: CHANNEL, rootId: "root" };
    const queryClient = await opened(thread);
    removeMessageFromCache(queryClient, CHANNEL, "root");
    expect(queryClient.getQueryData(timelineKey(thread))).toBeUndefined();
    expect(stored(thread)).toBeUndefined();
  });

  it("lands a send from history on the newest page, once", async () => {
    // Composer: a window that isn't live is replaced, not appended to.
    const queryClient = await opened();
    await jumpTo(queryClient, T, id(100));
    server.holding = true;
    const latest = jumpToLatest(queryClient, T);
    const sent = create(MessageSchema, { id: "m9000", channelId: CHANNEL });
    server.channel = [...server.channel, sent];
    // The socket's echo of the send, while the newest page is out.
    appendMessage(queryClient, sent);
    await answer();
    await latest;
    expect(ids(queryClient).filter((one) => one === "m9000")).toHaveLength(1);
    expect(ids(queryClient).at(-1)).toBe("m9000");
    expect(historyOf()).toMatchObject({ pendingNewer: 0, landOn: "bottom" });
  });
});

// These write the cache alone, as before the reducer: a page or a window
// that was out keeps the server's copy until the next event or refetch.
describe("writes that skip the reducer", () => {
  it("keep a pin on what was held, not on the page that was out", async () => {
    const queryClient = await opened();
    server.holding = true;
    const paging = loadOlder(queryClient, T);
    markPinned(queryClient, CHANNEL, id(380), true);
    markPinned(queryClient, CHANNEL, id(320), true);
    await answer();
    await paging;
    const window = windowOf(queryClient);
    expect(window.find((m) => m.id === id(380))?.pinned).toBe(true);
    expect(window.find((m) => m.id === id(320))?.pinned).toBe(false);
  });

  it("lose a reaction made while a jump was out", async () => {
    const queryClient = await opened();
    server.holding = true;
    const jumping = jumpTo(queryClient, T, id(390));
    setReactions(queryClient, CHANNEL, id(390), [
      create(ReactionSchema, { emoji: "👍" }),
    ]);
    await answer();
    await jumping;
    const reacted = windowOf(queryClient).find((m) => m.id === id(390));
    expect(reacted?.reactions).toEqual([]);
  });
});

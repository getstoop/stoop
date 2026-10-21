import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  applyTimelineEvent,
  isLive,
  reconnected,
  type Timeline,
  timelineKey,
  WINDOW_CAP,
} from "./history";
import { jumpTo, jumpToLatest, loadNewer, loadOlder } from "./timelineLoads";
import {
  answer,
  CHANNEL,
  deleteOnServer,
  editOnServer,
  event,
  historyOf,
  id,
  ids,
  opened,
  postOnServer,
  resetServer,
  server,
  T,
  windowOf,
} from "./timelineTestServer";

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }));
vi.mock("./clients", () => ({ chatClient: { listMessages } }));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

beforeEach(() => resetServer(listMessages));

describe("an event during a page", () => {
  it("keeps a message deleted while the older page was out", async () => {
    const queryClient = await opened();
    server.holding = true;
    const paging = loadOlder(queryClient, T);
    deleteOnServer(queryClient, id(320));
    await answer();
    await paging;
    expect(ids(queryClient)).toHaveLength(99);
    expect(ids(queryClient)).not.toContain(id(320));
  });

  it("keeps an edit made while the older page was out", async () => {
    const queryClient = await opened();
    server.holding = true;
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
    server.holding = true;
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
    server.holding = true;
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
    server.holding = true;
    const paging = loadOlder(queryClient, T);
    // While the socket was down: an edit nobody heard about.
    editOnServer(queryClient, id(320), "while away", false);
    // Ready: the catch-up goes, and lands before the page does.
    reconnected();
    const caughtUp = queryClient.refetchQueries({ queryKey: timelineKey(T) });
    server.held.pop()?.();
    await caughtUp;
    await answer();
    // The page went again, from what is held now.
    expect(server.held).toHaveLength(1);
    await answer();
    await paging;
    const window = windowOf(queryClient);
    expect(window).toHaveLength(100);
    expect(window.find((m) => m.id === id(320))?.content).toBe("while away");
  });

  it("keeps a page out during a refresh that isn't one", async () => {
    const queryClient = await opened();
    server.holding = true;
    const paging = loadOlder(queryClient, T);
    const refreshed = queryClient.refetchQueries({ queryKey: timelineKey(T) });
    server.held.pop()?.();
    await refreshed;
    await answer();
    await paging;
    expect(server.held).toHaveLength(0);
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
    server.replies = ["r1", "r2", "r3"].map((reply) =>
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

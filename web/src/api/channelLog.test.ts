import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelItems, threadItems } from "../core/channelLog";
import { useConnectionStore } from "../stores/connection";
import {
  applyEvent,
  catchUp,
  forget,
  HISTORY_PAGE,
  holdRow,
  isLive,
  jumpTo,
  jumpToLatest,
  loadNewer,
  loadOlder,
  openChannel,
  openThread,
  patchRow,
  patchThread,
  reconnected,
  useChannelLogStore,
} from "./channelLog";
import {
  answer,
  CHANNEL,
  deleteOnServer,
  editOnServer,
  event,
  id,
  logOf,
  next,
  pinOnServer,
  postOnServer,
  replyOnServer,
  resetServer,
  server,
  settle,
  sweepOnServer,
  TOTAL,
} from "./channelLogTestServer";

const { listMessages, listChanges } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listChanges: vi.fn(),
}));
vi.mock("./clients", () => ({ chatClient: { listMessages, listChanges } }));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

const VIEW = { channelId: CHANNEL };
const ids = () => channelItems(logOf()).map((row) => row.id);
const statusOf = (key = CHANNEL) => useChannelLogStore.getState().status[key];

beforeEach(() => resetServer(listMessages, listChanges));
afterEach(() => vi.useRealTimers());

describe("opening", () => {
  it("loads the newest page and takes the channel's seq", async () => {
    await openChannel(CHANNEL);
    expect(ids()).toHaveLength(HISTORY_PAGE);
    expect(ids()[HISTORY_PAGE - 1]).toBe(id(TOTAL - 1));
    expect(logOf().seq).toBe(TOTAL);
    expect(logOf().channel).toMatchObject({ hasOlder: true, hasNewer: false });
    expect(statusOf()?.loading).toBe(false);
  });

  it("shows loading while the page is out", async () => {
    server.holding = true;
    const opening = openChannel(CHANNEL);
    expect(statusOf()?.loading).toBe(true);
    await answer();
    await opening;
    expect(statusOf()?.loading).toBe(false);
  });

  it("opens a thread beside the channel", async () => {
    await openChannel(CHANNEL);
    postOnServer("r1", { threadRootId: id(390), inChannel: false });
    await openThread(CHANNEL, id(390));
    expect(threadItems(logOf(), id(390)).map((row) => row.id)).toEqual([
      id(390),
      "r1",
    ]);
    expect(listMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: id(390) }),
    );
  });
});

describe("a gap", () => {
  it("asks for the changes since the held seq and clears the flag", async () => {
    await openChannel(CHANNEL);
    postOnServer(next(0), {}, false);
    editOnServer(id(390), "reworded", false);
    postOnServer(next(1));
    expect(logOf().needsCatchUp).toBe(true);
    await settle();
    expect(listChanges).toHaveBeenCalledTimes(1);
    expect(listChanges).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, sinceSeq: BigInt(TOTAL) }),
    );
    expect(ids().slice(-2)).toEqual([next(0), next(1)]);
    expect(logOf().rows.get(id(390))?.content).toBe("reworded");
    expect(logOf().seq).toBe(TOTAL + 3);
    expect(logOf().needsCatchUp).toBe(false);
  });

  it("pages the changes while the server has more", async () => {
    await openChannel(CHANNEL);
    server.changesPage = 2;
    for (const offset of [0, 1, 2, 3, 4]) postOnServer(next(offset), {}, false);
    postOnServer(next(5));
    await settle();
    expect(listChanges).toHaveBeenCalledTimes(3);
    expect(listChanges.mock.calls.map(([req]) => Number(req.sinceSeq))).toEqual(
      [TOTAL, TOTAL + 2, TOTAL + 4],
    );
    expect(ids().slice(-6)).toEqual([0, 1, 2, 3, 4, 5].map(next));
    expect(logOf().seq).toBe(TOTAL + 6);
  });

  it("applies a deletion that arrived through the catch-up", async () => {
    await openChannel(CHANNEL);
    deleteOnServer(id(395), false);
    postOnServer(next(0));
    await settle();
    expect(ids()).not.toContain(id(395));
  });

  it("retries a failed catch-up while the socket is open", async () => {
    vi.useFakeTimers();
    await openChannel(CHANNEL);
    listChanges.mockRejectedValueOnce(new Error("unavailable"));
    postOnServer(next(0), {}, false);
    postOnServer(next(1));
    await vi.advanceTimersByTimeAsync(999);
    expect(listChanges).toHaveBeenCalledTimes(1);
    expect(logOf().needsCatchUp).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(listChanges).toHaveBeenCalledTimes(2);
    expect(logOf().needsCatchUp).toBe(false);
    expect(ids()).toContain(next(0));
  });

  it("gives up a failed catch-up once the socket is down", async () => {
    vi.useFakeTimers();
    await openChannel(CHANNEL);
    listChanges.mockRejectedValueOnce(new Error("unavailable"));
    useConnectionStore.setState({ status: "reconnecting" });
    postOnServer(next(0), {}, false);
    postOnServer(next(1));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(listChanges).toHaveBeenCalledTimes(1);
    expect(logOf().needsCatchUp).toBe(true);
  });

  it("stops a catch-up the server refuses", async () => {
    vi.useFakeTimers();
    await openChannel(CHANNEL);
    listChanges.mockRejectedValueOnce(
      new ConnectError("not yours", Code.PermissionDenied),
    );
    postOnServer(next(0), {}, false);
    postOnServer(next(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listChanges).toHaveBeenCalledTimes(1);
    expect(logOf().needsCatchUp).toBe(true);
  });
});

describe("reconnect", () => {
  it("catches up a channel that was empty when opened", async () => {
    server.rows = [];
    server.seq = 0;
    await openChannel(CHANNEL);
    expect(logOf().seq).toBe(0);
    postOnServer(next(0), {}, false);
    reconnected();
    await settle();
    expect(listChanges).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, sinceSeq: 0n }),
    );
    expect(ids()).toEqual([next(0)]);
    expect(logOf().seq).toBe(1);
  });

  it("catches every log up once, sharing concurrent calls", async () => {
    await openChannel(CHANNEL);
    await openChannel("other");
    postOnServer(next(0), {}, false);
    reconnected();
    const again = catchUp(CHANNEL);
    await Promise.all([again, catchUp(CHANNEL)]);
    await settle();
    expect(listChanges).toHaveBeenCalledTimes(2);
    expect(listChanges.mock.calls.map(([req]) => req.channelId).sort()).toEqual(
      [CHANNEL, "other"],
    );
    expect(ids()).toContain(next(0));
    expect(logOf().needsCatchUp).toBe(false);
  });
});

describe("paging", () => {
  it("prepends the older page, one request at a time", async () => {
    await openChannel(CHANNEL);
    server.holding = true;
    const first = loadOlder(VIEW);
    const second = loadOlder(VIEW);
    expect(listMessages).toHaveBeenCalledTimes(2);
    await answer();
    expect(await first).toBe(HISTORY_PAGE);
    expect(await second).toBe(0);
    expect(ids()).toHaveLength(2 * HISTORY_PAGE);
    expect(ids()[0]).toBe(id(TOTAL - 2 * HISTORY_PAGE));
  });

  it("drops a page that answers after a jump replaced the range", async () => {
    await openChannel(CHANNEL);
    server.holding = true;
    const paging = loadOlder(VIEW);
    const jumping = jumpTo(VIEW, id(100));
    // The jump answers first; the page was for the range it replaced.
    await answer("newest");
    await answer();
    expect(await paging).toBe(0);
    expect((await jumping).found).toBe(true);
    expect(ids()).toContain(id(100));
    expect(ids()).not.toContain(id(TOTAL - HISTORY_PAGE - 1));
    expect(logOf().channel.hasNewer).toBe(true);
  });

  it("pages forward after a jump until the view is live again", async () => {
    await openChannel(CHANNEL);
    await jumpTo(VIEW, id(100));
    postOnServer(next(0));
    expect(logOf().channel.pendingNewer).toBe(1);
    let brought = await loadNewer(VIEW);
    while (brought > 0) brought = await loadNewer(VIEW);
    expect(logOf().channel).toMatchObject({ hasNewer: false, pendingNewer: 0 });
    expect(ids()).toContain(next(0));
  });

  it("asks for nothing beyond a live view", async () => {
    await openChannel(CHANNEL);
    expect(await loadNewer(VIEW)).toBe(0);
    expect(listMessages).toHaveBeenCalledTimes(1);
  });
});

describe("jumps", () => {
  it("lands on a held row without a request", async () => {
    await openChannel(CHANNEL);
    expect(await jumpTo(VIEW, id(380))).toEqual({ found: true });
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(statusOf()?.landOn).toEqual({ id: id(380) });
  });

  it("loads a page around a row it doesn't hold", async () => {
    await openChannel(CHANNEL);
    expect(await jumpTo(VIEW, id(100))).toEqual({
      found: true,
      threadRootId: undefined,
    });
    expect(listMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ aroundId: id(100) }),
    );
    expect(ids()).toContain(id(100));
    expect(statusOf()?.landOn).toEqual({ id: id(100) });
  });

  it("names the thread when the server centred on a reply's root", async () => {
    await openChannel(CHANNEL);
    listMessages.mockResolvedValueOnce({
      ...(await listMessages.getMockImplementation()?.({
        aroundId: id(100),
      } as never)),
      threadRootId: id(100),
    });
    const result = await jumpTo(VIEW, "reply-in-thread");
    expect(result).toEqual({ found: true, threadRootId: id(100) });
    expect(statusOf()?.landOn).toEqual({ id: id(100) });
  });

  it("brings a view back to the newest page", async () => {
    await openChannel(CHANNEL);
    await jumpTo(VIEW, id(100));
    await jumpToLatest(VIEW);
    expect(logOf().channel.hasNewer).toBe(false);
    expect(ids()[ids().length - 1]).toBe(id(TOTAL - 1));
    expect(statusOf()?.landOn).toBe("bottom");
    await jumpToLatest(VIEW);
    expect(listMessages).toHaveBeenCalledTimes(3);
  });
});

describe("the reader's own rows", () => {
  it("holds a send's answer like an event's row, without moving the seq", async () => {
    await openChannel(CHANNEL);
    const sent = postOnServer(next(0), {}, false);
    holdRow(CHANNEL, sent);
    expect(ids()).toContain(next(0));
    expect(logOf().seq).toBe(TOTAL);
    // The event for it says nothing new; the position moves with it.
    applyEvent(event({ case: "messageCreated", value: sent }));
    expect(ids().filter((rowId) => rowId === next(0))).toHaveLength(1);
    expect(logOf().seq).toBe(TOTAL + 1);
  });

  it("holds an edit's answer, keeping the reader's half of the summary", async () => {
    await openChannel(CHANNEL);
    replyOnServer(id(390), next(0));
    patchThread(CHANNEL, id(390), { participating: true, unreadCount: 1 });
    const held = logOf().rows.get(id(390));
    if (!held?.thread) throw new Error("no summary");
    editOnServer(id(390), "reworded", false);
    const answer = server.rows.find((row) => row.id === id(390));
    if (!answer) throw new Error("no row");
    holdRow(CHANNEL, {
      ...answer,
      thread: { ...answer.thread, participating: false, unreadCount: 0 },
    } as typeof answer);
    const after = logOf().rows.get(id(390));
    expect(after?.content).toBe("reworded");
    expect(after?.thread).toMatchObject({
      participating: true,
      unreadCount: 1,
    });
  });

  it("holds a root for a thread opened before its channel's page", async () => {
    await openThread(CHANNEL, id(390));
    expect(threadItems(logOf(), id(390)).map((row) => row.id)).toEqual([]);
    const root = server.rows.find((row) => row.id === id(390));
    if (!root) throw new Error("no row");
    holdRow(CHANNEL, root);
    expect(threadItems(logOf(), id(390)).map((row) => row.id)).toEqual([
      id(390),
    ]);
  });

  it("does nothing for a channel that isn't held", () => {
    holdRow(CHANNEL, postOnServer(next(0), {}, false));
    expect(logOf()).toBeUndefined();
  });

  it("patches a held row at its seq, and the next event replaces it", async () => {
    await openChannel(CHANNEL);
    const before = logOf().rows.get(id(390));
    patchRow(CHANNEL, id(390), (row) => ({ ...row, pinned: true }));
    const patched = logOf().rows.get(id(390));
    expect(patched?.pinned).toBe(true);
    expect(patched?.seq).toBe(before?.seq);
    expect(patched).not.toBe(before);
    // The server's word, at a higher seq, wins over the patch.
    editOnServer(id(390), "reworded");
    expect(logOf().rows.get(id(390))).toMatchObject({
      pinned: false,
      content: "reworded",
    });
  });

  it("leaves a row it doesn't hold, and one the change leaves alone", async () => {
    await openChannel(CHANNEL);
    const rows = logOf().rows;
    patchRow(CHANNEL, "unknown", (row) => ({ ...row, pinned: true }));
    patchRow(CHANNEL, id(390), (row) => row);
    expect(logOf().rows).toBe(rows);
  });

  it("hides the reader's own delete until its tombstone comes", async () => {
    await openChannel(CHANNEL);
    patchRow(CHANNEL, id(390), (row) => ({ ...row, deleted: true }));
    expect(ids()).not.toContain(id(390));
    deleteOnServer(id(390));
    expect(ids()).not.toContain(id(390));
    expect(logOf().rows.get(id(390))?.content).toBe("");
  });
});

describe("isLive", () => {
  it("is so for a view at the newest row, or not yet held", async () => {
    expect(isLive(VIEW)).toBe(true);
    await openChannel(CHANNEL);
    expect(isLive(VIEW)).toBe(true);
    await jumpTo(VIEW, id(100));
    expect(isLive(VIEW)).toBe(false);
    await jumpToLatest(VIEW);
    expect(isLive(VIEW)).toBe(true);
  });
});

describe("the thread overlay", () => {
  it("patches the reader's half of a held root without a seq", async () => {
    await openChannel(CHANNEL);
    replyOnServer(id(390), next(0));
    expect(logOf().rows.get(id(390))?.thread).toMatchObject({
      replyCount: 1,
      participating: false,
    });
    const before = logOf().rows.get(id(390));
    patchThread(CHANNEL, id(390), { participating: true, unreadCount: 0 });
    const after = logOf().rows.get(id(390));
    expect(after?.thread).toMatchObject({ replyCount: 1, participating: true });
    expect(after?.seq).toBe(before?.seq);
  });
});

describe("the floor", () => {
  it("drops swept rows on a page, keeping a pinned root and its thread", async () => {
    await openChannel(CHANNEL);
    await jumpTo(VIEW, id(100));
    pinOnServer(id(90));
    postOnServer(next(0), { threadRootId: id(90), inChannel: true });
    expect(ids()).toContain(id(90));
    sweepOnServer(id(120));
    await loadOlder(VIEW);
    expect(ids()).not.toContain(id(100));
    expect(ids()).toContain(id(90));
    expect(logOf().rows.has(next(0))).toBe(true);
  });
});

describe("forget", () => {
  it("drops the log and ignores later events", async () => {
    await openChannel(CHANNEL);
    forget(CHANNEL);
    expect(logOf()).toBeUndefined();
    applyEvent(
      event({
        case: "messageCreated",
        value: postOnServer(next(0), {}, false),
      }),
    );
    expect(logOf()).toBeUndefined();
  });

  it("lets a page out answer to nobody, and pages again once reopened", async () => {
    await openChannel(CHANNEL);
    server.holding = true;
    const paging = loadOlder(VIEW);
    forget(CHANNEL);
    server.holding = false;
    await openChannel(CHANNEL);
    await answer();
    expect(await paging).toBe(0);
    expect(ids()).toHaveLength(HISTORY_PAGE);
    expect(statusOf()?.loading).toBe(false);
    expect(await loadOlder(VIEW)).toBe(HISTORY_PAGE);
    expect(ids()).toHaveLength(2 * HISTORY_PAGE);
  });

  it("keeps a channel never opened out of the store", async () => {
    expect(await loadOlder({ channelId: "unopened" })).toBe(0);
    await jumpToLatest({ channelId: "unopened" });
    expect(useChannelLogStore.getState().logs.unopened).toBeUndefined();
    expect(listMessages).not.toHaveBeenCalled();
  });
});

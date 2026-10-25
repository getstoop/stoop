import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import {
  type Message,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import { ReactionSchema } from "../gen/stoop/chat/v1/reaction_pb";
import { SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import type { ChannelHeader } from "./channelHeader";
import { channelItems, threadItems } from "./channelLog";
import {
  CHANNEL,
  changes,
  event,
  id,
  ids,
  message,
  page,
  rows,
} from "./channelLog/testing";
import {
  type ChannelScreen,
  emptyScreen,
  type ScreenAction,
  screenReducer,
} from "./channelScreen";
import { NO_CHANNELS } from "./mentions";

const header = (init: Partial<ChannelHeader> = {}): ChannelHeader => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, {
    id: CHANNEL,
    name: "general",
    lastReadMessageId: id(3),
  }),
  memberCount: 3,
  myUserId: "me",
  channels: NO_CHANNELS,
  ...init,
});

const run = (actions: ScreenAction[], from = emptyScreen(CHANNEL)) =>
  actions.reduce(screenReducer, from);

const opened = (
  generation: number,
  init: { rows?: ReturnType<typeof rows>; header?: ChannelHeader } = {},
): ScreenAction => ({
  type: "opened",
  generation,
  header: init.header ?? header(),
  res: page(init.rows ?? rows(0, 10), { hasOlder: true, channelSeq: 10 }),
  token: "t1",
});

const shown = (state: ChannelScreen) => ids(channelItems(state.log));

describe("opening", () => {
  it("sets the header, the page, the token and the New line's marker", () => {
    const state = run([opened(0)]);
    expect(state.header?.channel.name).toBe("general");
    expect(shown(state)).toEqual(ids(rows(0, 10)));
    expect(state.token).toBe("t1");
    expect(state.newAfter).toBe(id(3));
    expect(state.outcome).toBeNull();
    expect(state.log.seq).toBe(10);
  });

  it("drops a stale open's answer, header and all", () => {
    // Open A is slow; the socket drops; id(9) is deleted unseen; Ready
    // opens again as B, which answers first without it. A's page still
    // has it, at its old seq.
    const fresh = run([
      opened(0, {
        rows: rows(0, 9),
        header: header({
          channel: create(ChannelSchema, { id: CHANNEL, name: "lobby" }),
        }),
      }),
    ]);
    const late = screenReducer(fresh, opened(0));
    expect(late).toBe(fresh);
    expect(shown(late)).toEqual(ids(rows(0, 9)));
    expect(late.header?.channel.name).toBe("lobby");
  });

  it("takes a fresh open over the one before, keeping the New line's marker", () => {
    const first = run([opened(0)]);
    const again = screenReducer(
      first,
      opened(first.log.channel.generation, {
        rows: rows(5, 12, 6),
        header: header({
          memberCount: 7,
          channel: create(ChannelSchema, {
            id: CHANNEL,
            name: "general",
            lastReadMessageId: id(11),
          }),
        }),
      }),
    );
    expect(shown(again)).toEqual(ids(rows(5, 12)));
    expect(again.header?.memberCount).toBe(7);
    expect(again.newAfter).toBe(id(3));
  });

  it("stays gone or ended when a load lands late", () => {
    const gone = run([
      {
        type: "event",
        event: event({ case: "channelDeleted", value: { channelId: CHANNEL } }),
      },
    ]);
    expect(gone.outcome).toBe("gone");
    expect(screenReducer(gone, opened(0))).toBe(gone);
    const ended = run([{ type: "failed", outcome: "ended" }]);
    expect(screenReducer(ended, opened(0))).toBe(ended);
  });
});

describe("older pages", () => {
  const ready = run([opened(0)]);

  it("grows the range under the view's generation, once at a time", () => {
    const paging = screenReducer(ready, { type: "pagingOlder" });
    expect(paging.loadingOlder).toBe(true);
    const grown = screenReducer(paging, {
      type: "paged",
      generation: ready.log.channel.generation,
      res: page(rows(0, 0), { hasOlder: false }),
    });
    expect(grown.loadingOlder).toBe(false);
    expect(grown.log.channel.hasOlder).toBe(false);
  });

  it("drops a page asked for under an older generation", () => {
    const stale = screenReducer(screenReducer(ready, { type: "pagingOlder" }), {
      type: "paged",
      generation: 0,
      res: page([message("m-old", { seq: 1n })], { hasOlder: false }),
    });
    expect(stale.loadingOlder).toBe(false);
    expect(shown(stale)).toEqual(shown(ready));
    expect(stale.log.channel.hasOlder).toBe(true);
    expect(
      screenReducer(screenReducer(ready, { type: "pagingOlder" }), {
        type: "pageFailed",
      }).loadingOlder,
    ).toBe(false);
  });
});

describe("outcomes", () => {
  it("shows a failure before the channel opened, and a retry clears it", () => {
    const failed = run([{ type: "failed", outcome: "failed" }]);
    expect(failed.outcome).toBe("failed");
    expect(run([{ type: "retried" }], failed).outcome).toBeNull();
  });

  it("keeps what is shown when a load can't reach the server", () => {
    const ready = run([opened(0)]);
    expect(screenReducer(ready, { type: "failed", outcome: "failed" })).toBe(
      ready,
    );
    expect(
      screenReducer(ready, { type: "failed", outcome: "gone" }).outcome,
    ).toBe("gone");
    expect(
      screenReducer(ready, { type: "failed", outcome: "ended" }).outcome,
    ).toBe("ended");
  });

  it("is gone when the channel is deleted before its first page, not another", () => {
    const other = run([
      {
        type: "event",
        event: event({ case: "channelDeleted", value: { channelId: "c2" } }),
      },
    ]);
    expect(other.outcome).toBeNull();
    const gone = run(
      [
        {
          type: "event",
          event: event({
            case: "channelDeleted",
            value: { channelId: CHANNEL },
          }),
        },
      ],
      other,
    );
    expect(gone.outcome).toBe("gone");
  });

  it("is gone when the reader loses the channel once open", () => {
    const state = run([
      opened(0),
      {
        type: "event",
        event: event({
          case: "memberRemoved",
          value: { spaceId: "s1", userId: "me" },
        }),
      },
    ]);
    expect(state.outcome).toBe("gone");
  });
});

describe("events", () => {
  it("keeps an event seen while the first page is out, and owes a catch-up when the page predates it", () => {
    const early = run([
      {
        type: "event",
        event: event({
          case: "messageCreated",
          value: message(id(10), { seq: 11n }),
        }),
      },
    ]);
    expect(early.log.needsCatchUp).toBe(false);
    expect(early.log.rows.has(id(10))).toBe(true);
    const state = screenReducer(early, opened(0));
    expect(shown(state)).toEqual(ids(rows(0, 11)));
    expect(state.log.needsCatchUp).toBe(true);
  });

  it("applies the next seq and owes a catch-up past a gap, which caughtUp settles", () => {
    const ready = run([opened(0)]);
    const next = screenReducer(ready, {
      type: "event",
      event: event({
        case: "messageCreated",
        value: message(id(10), { seq: 11n }),
      }),
    });
    expect(next.log.seq).toBe(11);
    expect(next.log.needsCatchUp).toBe(false);
    const gapped = screenReducer(next, {
      type: "event",
      event: event({
        case: "messageCreated",
        value: message(id(12), { seq: 13n }),
      }),
    });
    expect(gapped.log.needsCatchUp).toBe(true);
    const caught = screenReducer(gapped, {
      type: "caughtUp",
      res: changes(
        [message(id(11), { seq: 12n }), message(id(12), { seq: 13n })],
        { channelSeq: 13 },
      ),
    });
    expect(caught.log.seq).toBe(13);
    expect(caught.log.needsCatchUp).toBe(false);
    expect(shown(caught)).toEqual(ids(rows(0, 13)));
  });

  it("owes a catch-up after a reconnect", () => {
    const state = run([opened(0), { type: "reconnected" }]);
    expect(state.log.needsCatchUp).toBe(true);
  });

  it("follows a rename, and a header fetched again replaces the one held", () => {
    const renamed = run([
      opened(0),
      {
        type: "event",
        event: event({
          case: "channelUpdated",
          value: create(ChannelSchema, { id: CHANNEL, name: "lobby" }),
        }),
      },
    ]);
    expect(renamed.header?.channel.name).toBe("lobby");
    const refreshed = screenReducer(renamed, {
      type: "header",
      header: header({ memberCount: 9 }),
    });
    expect(refreshed.header?.memberCount).toBe(9);
    expect(refreshed.newAfter).toBe(id(3));
    // Before the channel opened there is no header to replace.
    expect(
      screenReducer(emptyScreen(CHANNEL), { type: "header", header: header() })
        .header,
    ).toBeNull();
  });

  it("is the same state for an event about something else", () => {
    const ready = run([opened(0)]);
    expect(
      screenReducer(ready, {
        type: "event",
        event: event({ case: "channelRead", value: { channelId: "c2" } }),
      }),
    ).toBe(ready);
  });
});

describe("the reader's own send", () => {
  const ready = run([opened(0)]);
  // The reader's message, as the server answers it and as its event
  // carries it: the same row at the same seq.
  const mine = message(id(10), { seq: 11n, content: "mine" });
  const sent: ScreenAction = { type: "sent", message: mine };
  const created: ScreenAction = {
    type: "event",
    event: event({ case: "messageCreated", value: mine }),
  };

  it("shows the answer's row once when it lands before the event", () => {
    const answered = screenReducer(ready, sent);
    expect(shown(answered)).toEqual(ids(rows(0, 11)));
    // The answer is a row, not a change seen: the position waits for the
    // event, which then arrives as the next seq and is not a gap.
    expect(answered.log.seq).toBe(10);
    expect(answered.log.needsCatchUp).toBe(false);
    const both = screenReducer(answered, created);
    expect(shown(both)).toEqual(ids(rows(0, 11)));
    expect(both.log.seq).toBe(11);
    expect(both.log.needsCatchUp).toBe(false);
  });

  it("shows the row once when the event lands first, the server's copy winning the tie", () => {
    const eventFirst = screenReducer(ready, {
      type: "event",
      event: event({
        case: "messageCreated",
        value: message(id(10), { seq: 11n, content: "the event's copy" }),
      }),
    });
    const both = screenReducer(eventFirst, sent);
    expect(shown(both)).toEqual(ids(rows(0, 11)));
    expect(both.log.rows.get(id(10))?.content).toBe("mine");
    expect(both.log.seq).toBe(11);
    expect(both.log.needsCatchUp).toBe(false);
  });

  it("merges an answer that lands across a reconnect, which the catch-up then surrounds", () => {
    // The socket dropped after the send went out; someone else wrote
    // id(10) at 11 meanwhile, unseen, and the answer carries 12.
    const late = message(id(11), { seq: 12n, content: "mine" });
    const state = run(
      [{ type: "reconnected" }, { type: "sent", message: late }],
      ready,
    );
    expect(shown(state)).toEqual([...ids(rows(0, 10)), id(11)]);
    expect(state.log.needsCatchUp).toBe(true);
    expect(state.log.seq).toBe(10);
    const caught = screenReducer(state, {
      type: "caughtUp",
      res: changes([message(id(10), { seq: 11n }), late], { channelSeq: 12 }),
    });
    expect(shown(caught)).toEqual(ids(rows(0, 12)));
    expect(caught.log.seq).toBe(12);
    expect(caught.log.needsCatchUp).toBe(false);
  });

  it("is the same state for another channel's row", () => {
    const elsewhere = message(id(10), { seq: 11n, channelId: "c2" });
    expect(screenReducer(ready, { type: "sent", message: elsewhere })).toBe(
      ready,
    );
  });

  it("merges an answer under a fresh open, being a row and not a page", () => {
    // Opened again after a reconnect while the send was out: the range
    // was replaced (generation 2), and the answer still lands in it.
    const reopened = screenReducer(
      ready,
      opened(ready.log.channel.generation, { rows: rows(5, 10, 6) }),
    );
    const state = screenReducer(reopened, sent);
    expect(shown(state)).toEqual(ids(rows(5, 11)));
  });
});

describe("the reader's own reaction", () => {
  const ready = run([opened(0)]);
  // id(5) stands at seq 6 in the page; the toggle is made on that copy.
  const target = id(5);
  const seq = 6n;
  const thumbs = (...userIds: string[]) =>
    create(ReactionSchema, { emoji: "👍", userIds });
  const reacted: ScreenAction = {
    type: "reacted",
    messageId: target,
    seq,
    reactions: [thumbs("me")],
  };
  const rowOf = (state: ChannelScreen) => state.log.rows.get(target);

  it("writes the toggle to the held row at its own seq, and the event that follows replaces it", () => {
    const patched = screenReducer(ready, reacted);
    expect(rowOf(patched)?.reactions).toEqual([thumbs("me")]);
    expect(rowOf(patched)?.seq).toBe(seq);
    expect(patched.log.seq).toBe(10);
    expect(shown(patched)).toEqual(shown(ready));
    const settled = screenReducer(patched, {
      type: "event",
      event: event({
        case: "reactionsChanged",
        value: {
          channelId: CHANNEL,
          messageId: target,
          reactions: [thumbs("them", "me")],
          seq: 11n,
        },
      }),
    });
    expect(rowOf(settled)?.reactions).toEqual([thumbs("them", "me")]);
    expect(rowOf(settled)?.seq).toBe(11n);
    expect(settled.log.seq).toBe(11);
  });

  it("takes the answer's row over the patch, the event then being nothing new", () => {
    const answer = message(target, { seq: 11n, reactions: [thumbs("me")] });
    const answered = run([reacted, { type: "sent", message: answer }], ready);
    expect(rowOf(answered)).toMatchObject({
      seq: 11n,
      reactions: [thumbs("me")],
    });
    const both = screenReducer(answered, {
      type: "event",
      event: event({
        case: "reactionsChanged",
        value: {
          channelId: CHANNEL,
          messageId: target,
          reactions: [thumbs("me")],
          seq: 11n,
        },
      }),
    });
    expect(rowOf(both)?.reactions).toEqual([thumbs("me")]);
    expect(both.log.seq).toBe(11);
    expect(both.log.needsCatchUp).toBe(false);
  });

  it("reverts a refusal with the reactions from before, unless the row has moved on", () => {
    const revert: ScreenAction = { ...reacted, reactions: [] };
    const reverted = run([reacted, revert], ready);
    expect(rowOf(reverted)?.reactions).toEqual([]);
    expect(rowOf(reverted)?.seq).toBe(seq);
    // Someone else's reaction landed between the patch and the refusal:
    // the row carries the server's list, which the revert must not undo.
    const moved = run(
      [
        reacted,
        {
          type: "event",
          event: event({
            case: "reactionsChanged",
            value: {
              channelId: CHANNEL,
              messageId: target,
              reactions: [thumbs("them")],
              seq: 11n,
            },
          }),
        },
      ],
      ready,
    );
    expect(screenReducer(moved, revert)).toBe(moved);
    expect(rowOf(moved)?.reactions).toEqual([thumbs("them")]);
  });

  it("is the same state for a row not held, or not at that seq", () => {
    expect(screenReducer(ready, { ...reacted, messageId: "m-elsewhere" })).toBe(
      ready,
    );
    expect(screenReducer(ready, { ...reacted, seq: 5n })).toBe(ready);
  });
});

describe("the reader's own delete", () => {
  const ready = run([opened(0)]);
  const target = id(5);
  const deleted: ScreenAction = { type: "deleted", messageId: target };

  it("hides the row at once as a tombstone at its own seq, which the event then replaces", () => {
    const gone = screenReducer(ready, deleted);
    expect(shown(gone)).toEqual(
      ids(rows(0, 10)).filter((rowId) => rowId !== target),
    );
    expect(gone.log.rows.get(target)).toMatchObject({ deleted: true, seq: 6n });
    expect(gone.log.seq).toBe(10);
    const settled = screenReducer(gone, {
      type: "event",
      event: event({
        case: "messageDeleted",
        value: { channelId: CHANNEL, messageId: target, seq: 11n },
      }),
    });
    expect(shown(settled)).toEqual(shown(gone));
    expect(settled.log.rows.get(target)).toMatchObject({
      deleted: true,
      seq: 11n,
    });
    expect(settled.log.seq).toBe(11);
  });

  it("leaves a root with a thread summary to the server's update, and a row not held alone", () => {
    const rooted = run(
      [
        {
          type: "sent",
          message: message(target, { seq: 6n, thread: { replyCount: 2 } }),
        },
      ],
      ready,
    );
    expect(screenReducer(rooted, deleted)).toBe(rooted);
    expect(
      screenReducer(ready, { type: "deleted", messageId: "m-elsewhere" }),
    ).toBe(ready);
    const once = screenReducer(ready, deleted);
    expect(screenReducer(once, deleted)).toBe(once);
  });
});

describe("a thread over the channel", () => {
  const root = id(5);
  const summary = () =>
    create(ThreadSummarySchema, {
      replyCount: 2,
      unreadCount: 1,
      participating: true,
    });
  const withSummary = rows(0, 10).map((row) =>
    row.id === root ? { ...row, thread: summary() } : row,
  );
  const ready = run([opened(0, { rows: withSummary })]);
  const reply = (index: number, seq: number) =>
    message(`r${index}`, {
      threadRootId: root,
      inChannel: false,
      seq: BigInt(seq),
    });
  const threadPage = (replies = [reply(1, 11), reply(2, 12)]) =>
    page(replies, { hasOlder: false, channelSeq: 12 });
  const openThread = (from = ready, init: { root?: Message } = {}) =>
    run(
      [
        { type: "threadOpening", rootId: root },
        {
          type: "threadOpened",
          epoch: 1,
          rootId: root,
          generation: 0,
          res: threadPage(),
          ...init,
        },
      ],
      from,
    );

  it("opens on its root and its replies, the channel's rows untouched", () => {
    const state = openThread();
    expect(ids(threadItems(state.log, root))).toEqual([root, "r1", "r2"]);
    expect(shown(state)).toEqual(ids(rows(0, 10)));
    expect(state.threads[root]).toEqual({
      outcome: null,
      loadingOlder: false,
      epoch: 1,
    });
  });

  it("drops a page for a thread no screen has open", () => {
    const state = screenReducer(ready, {
      type: "threadOpened",
      epoch: 1,
      rootId: root,
      generation: 0,
      res: threadPage(),
    });
    expect(state).toBe(ready);
    const closed = run(
      [
        { type: "threadOpening", rootId: root },
        { type: "threadClosed", rootId: root },
        {
          type: "threadOpened",
          epoch: 1,
          rootId: root,
          generation: 0,
          res: threadPage(),
        },
      ],
      ready,
    );
    expect(closed.log.threads[root]).toBeUndefined();
    expect(closed.log.rows.has("r1")).toBe(false);
  });

  it("takes a fetched root it didn't hold, with the reader's half of its summary", () => {
    const empty = run([opened(0, { rows: rows(0, 3) })]);
    const fetched = message(root, { seq: 6n, thread: summary() });
    const state = openThread(empty, { root: fetched });
    expect(ids(threadItems(state.log, root))).toEqual([root, "r1", "r2"]);
    expect(state.log.rows.get(root)?.thread?.unreadCount).toBe(1);
  });

  it("goes live, and closing it lets go of its replies but not the root the channel shows", () => {
    const live = screenReducer(openThread(), {
      type: "event",
      event: event({ case: "messageCreated", value: reply(3, 13) }),
    });
    expect(ids(threadItems(live.log, root))).toEqual([root, "r1", "r2", "r3"]);
    const closed = screenReducer(live, { type: "threadClosed", rootId: root });
    expect(closed.threads[root]).toBeUndefined();
    expect(closed.log.threads[root]).toBeUndefined();
    expect(closed.log.rows.has("r3")).toBe(false);
    expect(shown(closed)).toEqual(ids(rows(0, 10)));
  });

  it("pages older replies under the thread's generation", () => {
    const state = run(
      [
        { type: "threadOpening", rootId: root },
        {
          type: "threadOpened",
          epoch: 1,
          rootId: root,
          generation: 0,
          res: page([reply(2, 12)], { hasOlder: true, channelSeq: 12 }),
        },
        { type: "threadPagingOlder", rootId: root },
      ],
      ready,
    );
    expect(state.threads[root].loadingOlder).toBe(true);
    const grown = screenReducer(state, {
      type: "threadPaged",
      epoch: 1,
      rootId: root,
      generation: state.log.threads[root].generation,
      res: page([reply(1, 11)], { hasOlder: false }),
    });
    expect(ids(threadItems(grown.log, root))).toEqual([root, "r1", "r2"]);
    expect(grown.threads[root].loadingOlder).toBe(false);
    expect(grown.log.threads[root].hasOlder).toBe(false);
  });

  it("keeps what it shows when the server can't be reached, and says when its root is gone", () => {
    const failed = run(
      [
        { type: "threadOpening", rootId: root },
        { type: "threadFailed", rootId: root, outcome: "failed" },
      ],
      ready,
    );
    expect(failed.threads[root].outcome).toBe("failed");
    expect(
      screenReducer(failed, { type: "threadOpening", rootId: root }).threads[
        root
      ].outcome,
    ).toBeNull();
    const open = openThread();
    expect(
      screenReducer(open, {
        type: "threadFailed",
        rootId: root,
        outcome: "failed",
      }),
    ).toBe(open);
    expect(
      screenReducer(open, {
        type: "threadFailed",
        rootId: root,
        outcome: "gone",
      }).threads[root].outcome,
    ).toBe("gone");
  });

  it("clears its unread count when read, here or on another device", () => {
    const read = screenReducer(openThread(), {
      type: "threadRead",
      rootId: root,
    });
    expect(read.log.rows.get(root)?.thread?.unreadCount).toBe(0);
    const elsewhere = screenReducer(ready, {
      type: "event",
      event: event({
        case: "threadRead",
        value: { channelId: CHANNEL, rootMessageId: root },
      }),
    });
    expect(elsewhere.log.rows.get(root)?.thread?.unreadCount).toBe(0);
    expect(
      screenReducer(ready, {
        type: "event",
        event: event({
          case: "threadRead",
          value: { channelId: "c2", rootMessageId: root },
        }),
      }),
    ).toBe(ready);
  });

  it("drops an older page asked for before the thread closed and opened again", () => {
    // Opened (epoch 1) with older replies; a page goes out; the screen
    // leaves and a new one opens the thread again (epoch 2) on a fresh
    // view at the same generation. The old page must not land.
    const first = run(
      [
        { type: "threadOpening", rootId: root },
        {
          type: "threadOpened",
          rootId: root,
          epoch: 1,
          generation: 0,
          res: page([reply(2, 12)], { hasOlder: true, channelSeq: 12 }),
        },
      ],
      ready,
    );
    const generation = first.log.threads[root].generation;
    const again = run(
      [
        { type: "threadClosed", rootId: root },
        { type: "threadOpening", rootId: root },
        {
          type: "threadOpened",
          rootId: root,
          epoch: 2,
          generation: 0,
          res: page([reply(4, 14)], { hasOlder: true, channelSeq: 14 }),
        },
      ],
      first,
    );
    expect(again.threads[root].epoch).toBe(2);
    expect(again.log.threads[root].generation).toBe(generation);
    const late = screenReducer(again, {
      type: "threadPaged",
      rootId: root,
      epoch: 1,
      generation,
      res: page([reply(1, 11)], { hasOlder: false }),
    });
    expect(late).toBe(again);
    expect(late.log.threads[root].hasOlder).toBe(true);
  });

  const changed = (replyCount: number, lastBy: string, seq: number) =>
    event({
      case: "threadChanged",
      value: {
        channelId: CHANNEL,
        rootMessageId: root,
        seq: BigInt(seq),
        thread: { replyCount: replyCount, recentAuthors: [{ id: lastBy }] },
      },
    });

  it("counts a reply by someone else in a thread the reader is in, not their own", () => {
    const more = screenReducer(ready, {
      type: "event",
      event: changed(3, "them", 11),
    });
    expect(more.log.rows.get(root)?.thread).toMatchObject({
      replyCount: 3,
      unreadCount: 2,
      participating: true,
    });
    const mine = screenReducer(more, {
      type: "event",
      event: changed(4, "me", 12),
    });
    expect(mine.log.rows.get(root)?.thread?.unreadCount).toBe(2);
    // The same event again is stale: counted once.
    expect(
      screenReducer(mine, { type: "event", event: changed(4, "me", 12) }),
    ).toBe(mine);
  });

  it("counts the reader in when a reply names them", () => {
    const outside = run([
      opened(0, {
        rows: rows(0, 10).map((row) =>
          row.id === root
            ? { ...row, thread: create(ThreadSummarySchema, { replyCount: 2 }) }
            : row,
        ),
      }),
    ]);
    const unnamed = screenReducer(outside, {
      type: "event",
      event: changed(3, "them", 11),
    });
    expect(unnamed.log.rows.get(root)?.thread?.unreadCount).toBe(0);
    const named = run(
      [
        {
          type: "event",
          event: event({
            case: "messageCreated",
            value: message("r9", {
              threadRootId: root,
              inChannel: false,
              seq: 11n,
              mentionUserIds: ["me"],
            }),
          }),
        },
        { type: "event", event: changed(3, "them", 12) },
      ],
      outside,
    );
    expect(named.log.rows.get(root)?.thread).toMatchObject({
      participating: true,
      unreadCount: 1,
    });
    expect(named.namedIn).toEqual({});
  });

  it("counts nothing while muted, here or on another device, and stays muted through a reply of the reader's", () => {
    const muted = screenReducer(ready, {
      type: "threadMuted",
      rootId: root,
      muted: true,
    });
    expect(muted.log.rows.get(root)?.thread).toMatchObject({
      muted: true,
      unreadCount: 0,
    });
    const quiet = run(
      [
        { type: "event", event: changed(3, "them", 11) },
        { type: "event", event: changed(4, "me", 12) },
      ],
      muted,
    );
    expect(quiet.log.rows.get(root)?.thread).toMatchObject({
      replyCount: 4,
      muted: true,
      unreadCount: 0,
    });
    const elsewhere = (muted: boolean, channelId = CHANNEL) =>
      event({
        case: "threadMuted",
        value: { channelId, rootMessageId: root, muted },
      });
    const unmuted = screenReducer(quiet, {
      type: "event",
      event: elsewhere(false),
    });
    expect(unmuted.log.rows.get(root)?.thread?.muted).toBe(false);
    const counted = screenReducer(unmuted, {
      type: "event",
      event: changed(5, "them", 13),
    });
    expect(counted.log.rows.get(root)?.thread?.unreadCount).toBe(1);
    expect(
      screenReducer(ready, { type: "event", event: elsewhere(true, "c2") }),
    ).toBe(ready);
    expect(
      screenReducer(ready, {
        type: "event",
        event: elsewhere(true),
      }).log.rows.get(root)?.thread,
    ).toMatchObject({ muted: true, unreadCount: 0 });
  });

  it("takes the reader's half from a page asked for again", () => {
    const read = screenReducer(ready, { type: "threadRead", rootId: root });
    const again = screenReducer(read, {
      type: "refreshed",
      res: page(withSummary, { channelSeq: 10 }),
    });
    expect(again.log.rows.get(root)?.thread?.unreadCount).toBe(1);
  });
});

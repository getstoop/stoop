import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import { ReactionSchema } from "../gen/stoop/chat/v1/reaction_pb";
import { SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import type { ChannelHeader } from "./channelHeader";
import { channelItems } from "./channelLog";
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

const header = (init: Partial<ChannelHeader> = {}): ChannelHeader => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, {
    id: CHANNEL,
    name: "general",
    lastReadMessageId: id(3),
  }),
  memberCount: 3,
  myUserId: "me",
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

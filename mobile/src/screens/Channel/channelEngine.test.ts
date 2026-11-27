import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ChannelHeader } from "@stoop/core/channelHeader";
import { channelItems } from "@stoop/core/channelLog";
import { CHANNEL, event, id, ids, message, page, rows } from "@stoop/core/channelLog/testing";
import { NO_CHANNELS } from "@stoop/core/mentions";
import { ChannelSchema } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { SpaceSchema } from "@stoop/gen/stoop/chat/v1/space_pb";
import { CredentialRevokedSchema, type ServerEvent, ServerEventSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAround,
  loadChannel,
  loadNewer,
  loadOlder,
  loadReplies,
  loadRoot,
  sendMessage,
} from "../../api/messages";
import { closePoll, createPoll, createTimePoll, setPollVote } from "../../api/polls";
import type { SavedServer } from "../../servers";
import { channelEngine, holdEngine } from "./channelEngine";

vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("../../api/files", () => ({ uploadAttachment: vi.fn() }));
vi.mock("../../api/servers", () => ({ sessionToken: async () => "t1" }));
vi.mock("../../api/polls", () => ({
  createPoll: vi.fn(),
  createTimePoll: vi.fn(),
  setPollVote: vi.fn(),
  closePoll: vi.fn(),
}));
vi.mock("../../api/messages", () => ({
  ChannelGone: class extends Error {},
  PAGE: 50,
  loadAround: vi.fn(),
  loadChannel: vi.fn(),
  loadNewer: vi.fn(),
  loadOlder: vi.fn(),
  loadPage: vi.fn(),
  loadReplies: vi.fn(),
  loadRoot: vi.fn(),
  sendMessage: vi.fn(),
}));

const SERVER = { id: "server", origin: "https://stoop.example" } as SavedServer;
const ROOT = "root";
const COOLDOWN_MS = 10_000;

const header: ChannelHeader = {
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: CHANNEL, name: "general" }),
  memberCount: 2,
  members: [],
  groups: [],
  myUserId: "me",
  channels: NO_CHANNELS,
};

const flush = () => vi.advanceTimersByTimeAsync(0);
const asked = (load: unknown) => vi.mocked(load as () => unknown).mock.calls.length;

const releases: (() => void)[] = [];

// An engine holding an open channel of ten rows with older pages to go, every
// page after the first failing, and the rows it shows; let go after the test
// if the test hasn't.
async function openEngine(rootId?: string) {
  vi.mocked(loadChannel).mockResolvedValue({
    header,
    page: page(rows(10, 20), { hasOlder: true, channelSeq: 20 }),
    found: false,
  });
  vi.mocked(loadOlder).mockRejectedValue(new Error("offline"));
  vi.mocked(loadNewer).mockRejectedValue(new Error("offline"));
  const { engine, release } = holdEngine(
    channelEngine(SERVER, "s1", CHANNEL, () => () => {}),
    rootId,
  );
  releases.push(release);
  await vi.waitFor(() => expect(engine.current().header).not.toBeNull());
  await flush();
  return { engine, release, shown: ids(channelItems(engine.current().log)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});

const refuse = (message: string, code: Code) => vi.mocked(sendMessage).mockRejectedValue(new ConnectError(message, code));

describe("the socket saying the session has ended", () => {
  it("ends the session as a refused request does", async () => {
    vi.mocked(loadChannel).mockResolvedValue({
      header,
      page: page(rows(10, 20), { hasOlder: true, channelSeq: 20 }),
      found: false,
    });
    let say: (event: ServerEvent) => void = () => {};
    const { engine, release } = holdEngine(
      channelEngine(SERVER, "s1", CHANNEL, (_serverId, listener) => {
        say = listener;
        return () => {};
      }),
    );
    await vi.waitFor(() => expect(engine.current().header).not.toBeNull());
    say(create(ServerEventSchema, { payload: { case: "credentialRevoked", value: create(CredentialRevokedSchema) } }));
    expect(engine.current().outcome).toBe("ended");
    release();
  });
});

describe("a refused send", () => {
  it.each([
    ["in the channel", {}],
    ["with a quote", { replyToMessageId: "quoted" }],
    ["in a thread", { threadRootId: "root", alsoSendToChannel: true }],
  ])("leaves the screen as it is when permission is denied, %s", async (_where, to) => {
    const { engine, release, shown } = await openEngine();
    refuse("you can't message this person", Code.PermissionDenied);
    await expect(engine.send("hello", to)).rejects.toThrow("you can't message this person");
    expect(engine.current().outcome).toBeNull();
    expect(ids(channelItems(engine.current().log))).toEqual(shown);
    release();
  });

  it("ends the session when the sign-in has ended", async () => {
    const { engine, release } = await openEngine();
    refuse("expired", Code.Unauthenticated);
    await expect(engine.send("hello")).rejects.toThrow("expired");
    expect(engine.current().outcome).toBe("ended");
    release();
  });

  it("calls the channel gone when it isn't found, with no root or quote named", async () => {
    const { engine, release } = await openEngine();
    refuse("channel not found", Code.NotFound);
    await expect(engine.send("hello")).rejects.toThrow("channel not found");
    expect(engine.current().outcome).toBe("gone");
    release();
  });
});

describe("a failed older page", () => {
  it("sends nothing however often the list asks until the cooldown passes", async () => {
    const { engine } = await openEngine();
    await engine.older();
    expect(asked(loadOlder)).toBe(1);
    expect(engine.current().olderFailedAt).toBe(Date.now());
    expect(engine.current().loadingOlder).toBe(false);

    // The list asks again as the spinner goes and the retry row comes.
    await engine.older();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1);
    await engine.older();
    expect(asked(loadOlder)).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
    // That failure starts another wait.
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
  });

  it("sends nothing by itself when the cooldown passes", async () => {
    const { engine } = await openEngine();
    await engine.older();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 5);
    expect(asked(loadOlder)).toBe(1);
    expect(engine.current().olderFailedAt).not.toBeNull();
  });

  it("is asked for again at once by the reader's tap, which clears the failure on success", async () => {
    const { engine } = await openEngine();
    await engine.older();
    vi.mocked(loadOlder).mockResolvedValue(page(rows(0, 10), { hasOlder: false, channelSeq: 20 }));
    const retry = engine.retryOlder();
    expect(engine.current().olderFailedAt).toBeNull();
    expect(engine.current().loadingOlder).toBe(true);
    await retry;
    expect(asked(loadOlder)).toBe(2);
    expect(engine.current().olderFailedAt).toBeNull();
    expect(engine.current().log.channel.hasOlder).toBe(false);
  });

  it("holds nothing back after a success", async () => {
    const { engine } = await openEngine();
    vi.mocked(loadOlder).mockResolvedValue(page(rows(5, 10), { hasOlder: true, channelSeq: 20 }));
    await engine.older();
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
  });
});

describe("a failed newer page", () => {
  it("waits on its own, without holding back the older edge", async () => {
    const { engine } = await openEngine();
    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }));
    await engine.jumpTo(id(35));
    engine.landed();
    await engine.newer();
    expect(asked(loadNewer)).toBe(1);
    expect(engine.current().newerFailedAt).toBe(Date.now());

    await engine.newer();
    expect(asked(loadNewer)).toBe(1);
    await engine.older();
    expect(asked(loadOlder)).toBe(1);

    await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
    await engine.newer();
    expect(asked(loadNewer)).toBe(2);

    await engine.retryNewer();
    expect(asked(loadNewer)).toBe(3);
  });
});

describe("a failed page of replies", () => {
  it("waits the same way, and a tap goes at once", async () => {
    vi.mocked(loadReplies).mockImplementation((async (...args: unknown[]) => {
      if (args[4]) throw new Error("offline");
      return page([message("r5", { seq: 25n, threadRootId: ROOT, inChannel: false })], {
        hasOlder: true,
        channelSeq: 25,
      });
    }) as never);
    vi.mocked(loadRoot).mockResolvedValue(message(ROOT, { seq: 5n }) as never);
    const { engine } = await openEngine(ROOT);
    const beforeId = () => vi.mocked(loadReplies).mock.calls.filter((call) => call[4]).length;

    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(1);
    expect(engine.current().threads[ROOT].olderFailedAt).toBe(Date.now());
    expect(engine.current().threads[ROOT].loadingOlder).toBe(false);

    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(1);

    await engine.retryOlderReplies(ROOT);
    expect(beforeId()).toBe(2);

    await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(3);
  });
});

describe("a page refused for good", () => {
  const refused = (code: Code) => new ConnectError("refused", code);

  it("shows the sign-in ended, with no retry to offer", async () => {
    const { engine } = await openEngine();
    vi.mocked(loadOlder).mockRejectedValue(refused(Code.Unauthenticated));
    await engine.older();
    expect(engine.current().outcome).toBe("ended");
    expect(engine.current().loadingOlder).toBe(false);
  });

  it("shows the channel gone for a NotFound on either edge", async () => {
    const { engine: older, release } = await openEngine();
    vi.mocked(loadOlder).mockRejectedValue(refused(Code.NotFound));
    await older.older();
    expect(older.current().outcome).toBe("gone");
    release();

    const { engine: newer } = await openEngine();
    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }));
    await newer.jumpTo(id(35));
    newer.landed();
    vi.mocked(loadNewer).mockRejectedValue(refused(Code.NotFound));
    await newer.newer();
    expect(newer.current().outcome).toBe("gone");
    expect(newer.current().loadingNewer).toBe(false);
  });

  it("shows the sign-in ended for the newer edge", async () => {
    const { engine } = await openEngine();
    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }));
    await engine.jumpTo(id(35));
    engine.landed();
    vi.mocked(loadNewer).mockRejectedValue(refused(Code.Unauthenticated));
    await engine.newer();
    expect(engine.current().outcome).toBe("ended");
  });

  // The draft is kept on the device, so nothing is lost by leaving the
  // screen the way catch-up, the header refresh and jump to latest do.
  it("shows the channel gone for a PermissionDenied on either edge", async () => {
    const { engine: older, release } = await openEngine();
    vi.mocked(loadOlder).mockRejectedValue(refused(Code.PermissionDenied));
    await older.older();
    expect(older.current().outcome).toBe("gone");
    expect(older.current().loadingOlder).toBe(false);
    release();

    const { engine: newer } = await openEngine();
    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }));
    await newer.jumpTo(id(35));
    newer.landed();
    vi.mocked(loadNewer).mockRejectedValue(refused(Code.PermissionDenied));
    await newer.newer();
    expect(newer.current().outcome).toBe("gone");
    expect(newer.current().loadingNewer).toBe(false);
  });

  it("keeps the retry row for any other failure, on either edge", async () => {
    const { engine } = await openEngine();
    vi.mocked(loadOlder).mockRejectedValue(refused(Code.Unavailable));
    await engine.older();
    expect(engine.current().outcome).toBeNull();
    expect(engine.current().olderFailedAt).toBe(Date.now());

    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }));
    await engine.jumpTo(id(35));
    engine.landed();
    vi.mocked(loadNewer).mockRejectedValue(refused(Code.Unavailable));
    await engine.newer();
    expect(engine.current().outcome).toBeNull();
    expect(engine.current().newerFailedAt).toBe(Date.now());
  });

  describe("in a thread", () => {
    async function openThread(error: Error) {
      vi.mocked(loadReplies).mockImplementation((async (...args: unknown[]) => {
        if (args[4]) throw error;
        return page([message("r5", { seq: 25n, threadRootId: ROOT, inChannel: false })], {
          hasOlder: true,
          channelSeq: 25,
        });
      }) as never);
      vi.mocked(loadRoot).mockResolvedValue(message(ROOT, { seq: 5n }) as never);
      const { engine } = await openEngine(ROOT);
      await engine.olderReplies(ROOT);
      return engine.current();
    }

    it("shows the sign-in ended", async () => {
      const state = await openThread(refused(Code.Unauthenticated));
      expect(state.outcome).toBe("ended");
      expect(state.threads[ROOT].loadingOlder).toBe(false);
    });

    it("takes a NotFound as the thread gone, leaving the channel", async () => {
      const state = await openThread(refused(Code.NotFound));
      expect(state.threads[ROOT].outcome).toBe("gone");
      expect(state.threads[ROOT].loadingOlder).toBe(false);
      expect(state.outcome).toBeNull();
    });

    it("takes a PermissionDenied as the thread gone, leaving the channel", async () => {
      const state = await openThread(refused(Code.PermissionDenied));
      expect(state.threads[ROOT].outcome).toBe("gone");
      expect(state.threads[ROOT].loadingOlder).toBe(false);
      expect(state.outcome).toBeNull();
    });

    it("keeps the retry row for any other failure", async () => {
      const state = await openThread(refused(Code.Unavailable));
      expect(state.outcome).toBeNull();
      expect(state.threads[ROOT].outcome).toBeNull();
      expect(state.threads[ROOT].olderFailedAt).toBe(Date.now());
    });
  });
});

describe("a new sign-in to the same server", () => {
  it("is not handed the log still held for the session before", async () => {
    const { engine } = await openEngine();
    const signedInAgain = { ...SERVER, session: (SERVER.session ?? 0) + 1 };
    expect(channelEngine(SERVER, "s1", CHANNEL, () => () => {})).toBe(engine);
    expect(channelEngine(signedInAgain, "s1", CHANNEL, () => () => {})).not.toBe(engine);
  });
});

// A channel of ten rows (seqs 1 to 10) and a poll at seq 11, the channel at
// seq 11, with the socket's events in the test's hand.
const POLL = id(20);
const pollRow = (seq: number, voters: string[] = [], closed = false): Message =>
  message(POLL, {
    seq: BigInt(seq),
    content: "Friday?",
    event: {
      kind: {
        case: "poll",
        value: {
          question: "Friday?",
          options: [
            { id: 1, text: "A", voters: voters.map((voter) => ({ id: voter })) },
            { id: 2, text: "B" },
          ],
          voterCount: voters.length,
          ...(closed ? { closedAt: { seconds: 1n } } : {}),
        },
      },
    },
  });

async function openPollEngine() {
  vi.mocked(loadChannel).mockResolvedValue({
    header,
    page: page([...rows(10, 20), pollRow(11)], { hasOlder: true, channelSeq: 11 }),
    found: false,
  });
  vi.mocked(loadOlder).mockRejectedValue(new Error("offline"));
  let say: (event: ServerEvent) => void = () => {};
  const { engine, release } = holdEngine(
    channelEngine(SERVER, "s1", CHANNEL, (_serverId, listener) => {
      say = listener;
      return () => {};
    }),
  );
  releases.push(release);
  await vi.waitFor(() => expect(engine.current().header).not.toBeNull());
  await flush();
  const held = () => engine.current().log.rows.get(POLL);
  const voters = () => {
    const kind = held()?.event?.kind;
    return kind?.case === "poll" ? kind.value.options[0].voters.map((voter) => voter.id) : [];
  };
  return { engine, release, say: (row: Message) => say(event({ case: "messageUpdated", value: row })), held, voters };
}

describe("a vote", () => {
  it("settles from its answer, which is all there is when nothing changed", async () => {
    const { engine, held } = await openPollEngine();
    // The server held this selection already: the poll as it was, no event.
    const unchanged = pollRow(11);
    vi.mocked(setPollVote).mockResolvedValue(unchanged);
    await engine.vote(pollRow(11), []);
    expect(setPollVote).toHaveBeenCalledWith(SERVER.origin, "t1", POLL, []);
    expect(held()?.seq).toBe(11n);
  });

  it("merges a changed poll from the answer when the event has not come", async () => {
    const { engine, held, voters } = await openPollEngine();
    vi.mocked(setPollVote).mockResolvedValue(pollRow(12, ["me"]));
    await engine.vote(pollRow(11), [1]);
    expect(held()?.seq).toBe(12n);
    expect(voters()).toEqual(["me"]);
  });

  it("loses to a newer event that came first", async () => {
    const { engine, say, held, voters } = await openPollEngine();
    let answer: (row: Message) => void = () => {};
    vi.mocked(setPollVote).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const voting = engine.vote(pollRow(11), [1]);
    // The reader's vote at 12, then someone else's at 13, before the answer.
    say(pollRow(12, ["me"]));
    say(pollRow(13, ["me", "them"]));
    answer(pollRow(12, ["me"]));
    await voting;
    expect(held()?.seq).toBe(13n);
    expect(voters()).toEqual(["me", "them"]);
  });

  it("passes a refusal on, and says nothing once the log has gone", async () => {
    const { engine, release } = await openPollEngine();
    vi.mocked(setPollVote).mockRejectedValue(new ConnectError("the poll is closed", Code.FailedPrecondition));
    await expect(engine.vote(pollRow(11), [1])).rejects.toThrow("the poll is closed");
    let refuse: (err: Error) => void = () => {};
    vi.mocked(setPollVote).mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));
    const late = engine.vote(pollRow(11), [1]);
    release();
    refuse(new ConnectError("the poll is closed", Code.FailedPrecondition));
    await expect(late).resolves.toBeUndefined();
  });
});

describe("creating a poll", () => {
  it("merges the new poll from the answer", async () => {
    const { engine } = await openPollEngine();
    const made = message(id(30), { seq: 12n, content: "Saturday?" });
    vi.mocked(createPoll).mockResolvedValue(made);
    await engine.createPoll("Saturday?", ["A", "B"], false);
    expect(createPoll).toHaveBeenCalledWith(SERVER.origin, "t1", CHANNEL, "Saturday?", ["A", "B"], false);
    expect(engine.current().log.rows.get(id(30))?.seq).toBe(12n);
  });

  it("sends a time poll's times, never options, and merges the answer", async () => {
    const { engine } = await openPollEngine();
    const made = message(id(31), { seq: 12n, content: "Game night?" });
    vi.mocked(createTimePoll).mockResolvedValue(made);
    const times = [timestampFromDate(new Date("2030-01-04T19:00:00Z")), timestampFromDate(new Date("2030-01-05T19:00:00Z"))];
    await engine.createTimePoll("Game night?", times, true);
    expect(createTimePoll).toHaveBeenCalledWith(SERVER.origin, "t1", CHANNEL, "Game night?", times, true);
    expect(createPoll).not.toHaveBeenCalled();
    expect(engine.current().log.rows.get(id(31))?.seq).toBe(12n);
  });

  it("passes a time poll's refusal on and adds nothing", async () => {
    const { engine } = await openPollEngine();
    const before = engine.current().log;
    vi.mocked(createTimePoll).mockRejectedValue(new ConnectError("that time has passed", Code.InvalidArgument));
    await expect(engine.createTimePoll("Game night?", [], true)).rejects.toThrow("that time has passed");
    expect(engine.current().log.rows).toBe(before.rows);
  });

  it("passes a refusal on and adds nothing", async () => {
    const { engine } = await openPollEngine();
    const before = engine.current().log;
    vi.mocked(createPoll).mockRejectedValue(new ConnectError("only admins can post", Code.PermissionDenied));
    await expect(engine.createPoll("Saturday?", ["A", "B"], false)).rejects.toThrow("only admins can post");
    expect(engine.current().log.rows).toBe(before.rows);
    expect(engine.current().outcome).toBeNull();
  });
});

describe("closing a poll", () => {
  it("merges the closed poll from the answer", async () => {
    const { engine, held } = await openPollEngine();
    vi.mocked(closePoll).mockResolvedValue(pollRow(12, [], true));
    await engine.closePoll(pollRow(11));
    const kind = held()?.event?.kind;
    expect(kind?.case === "poll" && !!kind.value.closedAt).toBe(true);
  });

  it("says nothing of a refusal once the log has gone", async () => {
    const { engine, release } = await openPollEngine();
    let refuse: (err: Error) => void = () => {};
    vi.mocked(closePoll).mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));
    const late = engine.closePoll(pollRow(11));
    release();
    refuse(new ConnectError("already closed", Code.FailedPrecondition));
    await expect(late).resolves.toBeUndefined();
  });
});

import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollOf } from "../core/polls";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { openChannel } from "./channelLog";
import {
  CHANNEL,
  id,
  logOf,
  postOnServer,
  resetServer,
  server,
} from "./channelLogTestServer";
import { pendingVote, createPoll as postPoll, pressPollOption } from "./polls";

const { listMessages, listChanges, setPollVote, createPoll, notice } =
  vi.hoisted(() => ({
    listMessages: vi.fn(),
    listChanges: vi.fn(),
    setPollVote: vi.fn(),
    createPoll: vi.fn(),
    notice: vi.fn(),
  }));
vi.mock("./clients", () => ({
  chatClient: { listMessages, listChanges, setPollVote, createPoll },
}));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));
vi.mock("../stores/dialogs", () => ({ notice }));
vi.mock("../stores/announcer", () => ({ announce: vi.fn() }));

const ME = "maya";
const POLL = id(401);

// A poll of several choices, as the server holds it, with Maya among the
// voters of the options given.
function pollRow(mine: number[], seq = server.seq): Message {
  return create(MessageSchema, {
    id: POLL,
    channelId: CHANNEL,
    seq: BigInt(seq),
    event: {
      kind: {
        case: "poll",
        value: {
          question: "Friday?",
          multiple: true,
          voterCount: mine.length > 0 ? 1 : 0,
          options: [1, 2, 3].map((option) => ({
            id: option,
            text: `Option ${option}`,
            voters: mine.includes(option) ? [{ id: ME }] : [],
          })),
        },
      },
    },
  });
}

const held = () => logOf().rows.get(POLL) as Message;
const chosen = (message: Message) =>
  pollOf(message)
    ?.options.filter((option) => option.voters.length > 0)
    .map((option) => option.id);

// The server's answer, held until released.
function answerLater(rows: () => Message) {
  let release: () => void = () => {};
  setPollVote.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ message: rows() });
      }),
  );
  return () => release();
}

beforeEach(async () => {
  resetServer(listMessages, listChanges);
  setPollVote.mockReset();
  notice.mockReset();
  await openChannel(CHANNEL);
  postOnServer(POLL, pollRow([]));
});

describe("pressing an option", () => {
  it("is pending until the answer, which settles it with no event", async () => {
    // An unchanged vote: the server answers the poll as it was and
    // publishes nothing.
    const release = answerLater(() => pollRow([1], server.seq + 1));
    const done = pressPollOption(held(), 1, ME);
    expect(pendingVote(POLL)).toBe(1);
    expect(setPollVote).toHaveBeenCalledWith(
      { messageId: POLL, optionIds: [1] },
      { timeoutMs: 15_000 },
    );
    release();
    await done;
    expect(pendingVote(POLL)).toBeNull();
    expect(chosen(held())).toEqual([1]);
  });

  it("ignores a second press while a vote is out", async () => {
    const release = answerLater(() => pollRow([1], server.seq + 1));
    const first = pressPollOption(held(), 1, ME);
    expect(await pressPollOption(held(), 2, ME)).toBe(false);
    expect(setPollVote).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
  });

  it("says a refusal and leaves the card as the server has it", async () => {
    const before = held();
    setPollVote.mockRejectedValueOnce(new Error("This poll is closed."));
    await pressPollOption(before, 2, ME);
    expect(notice).toHaveBeenCalledWith({
      title: "Couldn't vote",
      body: "This poll is closed.",
    });
    expect(pendingVote(POLL)).toBeNull();
    expect(held()).toBe(before);
  });

  it("keeps the vote out across the card being drawn again", async () => {
    // Press 1; the card leaves the list and comes back while the vote is
    // out. The pending vote is not the card's, so the card drawn again
    // still shows it and still takes no press.
    const release = answerLater(() => pollRow([1], server.seq + 1));
    const first = pressPollOption(held(), 1, ME);
    expect(pendingVote(POLL)).toBe(1);
    expect(await pressPollOption(held(), 2, ME)).toBe(false);
    release();
    await first;
    // The next press builds on the answer, not on the row as it was.
    setPollVote.mockResolvedValueOnce({
      message: pollRow([1, 2], server.seq + 2),
    });
    await pressPollOption(held(), 2, ME);
    expect(setPollVote).toHaveBeenLastCalledWith(
      { messageId: POLL, optionIds: [1, 2] },
      { timeoutMs: 15_000 },
    );
    expect(chosen(held())).toEqual([1, 2]);
  });
});

describe("posting a poll", () => {
  const request = {
    channelId: CHANNEL,
    question: "Friday?",
    options: ["a", "b"],
    multiple: false,
  };

  it("holds the answer, before any event", async () => {
    const NEW = id(402);
    const answer = create(MessageSchema, {
      ...pollRow([], server.seq + 1),
      id: NEW,
    });
    createPoll.mockResolvedValueOnce({ message: answer });
    await postPoll(request);
    expect(createPoll).toHaveBeenCalledWith(request);
    expect(logOf().rows.get(NEW)).toBe(answer);
  });

  it("throws a refusal for the form to say", async () => {
    createPoll.mockRejectedValueOnce(new Error("refused"));
    await expect(postPoll(request)).rejects.toThrow("refused");
  });
});

import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageAuthorSchema,
  MessageSchema,
  type Poll,
  PollSchema,
  SystemEventSchema,
} from "../gen/stoop/chat/v1/message_pb";
import {
  isPollOpen,
  isPollRow,
  mySelection,
  nextSelection,
  outcomeOf,
  pollOf,
  pollPermissions,
  pollPreview,
  pollResults,
  votersLabel,
  votersShown,
  votesLabel,
} from "./polls";
import { isSystemRow } from "./systemMessages";

const person = (id: string) =>
  create(MessageAuthorSchema, { id, username: id, displayName: id });
const [maya, jun, sam, priya, elif, tomas] = [
  "maya",
  "jun",
  "sam",
  "priya",
  "elif",
  "tomas",
].map(person);

const makePoll = (
  options: { id: number; text: string; voters: (typeof maya)[] }[],
  extra: { multiple?: boolean; closed?: boolean } = {},
): Poll =>
  create(PollSchema, {
    question: "What are we playing on Friday?",
    options,
    multiple: extra.multiple ?? false,
    closedAt: extra.closed ? timestampNow() : undefined,
    voterCount: new Set(options.flatMap((o) => o.voters.map((v) => v.id))).size,
  });

const rowOf = (poll: Poll, authorId = "jun"): Message => {
  const message = create(MessageSchema, {
    id: "p1",
    content: poll.question,
    author: person(authorId),
  });
  message.event = create(SystemEventSchema, {
    kind: { case: "poll", value: poll },
  });
  return message;
};

// Board 2.5's poll after Maya's vote.
const single = makePoll([
  { id: 1, text: "The co-op campaign", voters: [jun, sam, maya] },
  { id: 2, text: "Racing league", voters: [priya, elif] },
  { id: 3, text: "Card night", voters: [tomas] },
]);

// Board 2.6's: several choices each.
const multiple = makePoll(
  [
    { id: 1, text: "Pizza", voters: [maya, jun, sam, priya] },
    { id: 2, text: "Dumplings", voters: [maya, priya, tomas] },
    { id: 3, text: "Tacos", voters: [jun, priya] },
    { id: 4, text: "Curry", voters: [] },
  ],
  { multiple: true },
);

describe("reading a poll off a row", () => {
  it("finds the poll, and nothing on another row", () => {
    const row = rowOf(single);
    expect(pollOf(row)).toBe(single);
    expect(isPollRow(row)).toBe(true);
    // Still a system row on the wire: the lists ask isPollRow first.
    expect(isSystemRow(row)).toBe(true);
    expect(isPollRow(create(MessageSchema, { content: "hi" }))).toBe(false);
    const closing = create(MessageSchema, {});
    closing.event = create(SystemEventSchema, {
      kind: { case: "pollClosed", value: { question: "Q?" } },
    });
    expect(isPollRow(closing)).toBe(false);
  });

  it("is open until it has a closing time", () => {
    expect(isPollOpen(single)).toBe(true);
    expect(isPollOpen(makePoll([], { closed: true }))).toBe(false);
  });

  it("words the previews as the server does", () => {
    expect(pollPreview(rowOf(single))).toBe(
      "Poll: What are we playing on Friday?",
    );
    const closing = create(MessageSchema, { content: "Friday?" });
    closing.event = create(SystemEventSchema, {
      kind: { case: "pollClosed", value: { question: "Friday?" } },
    });
    expect(pollPreview(closing)).toBe("Poll closed: Friday?");
    expect(pollPreview(create(MessageSchema, { content: "hi" }))).toBeNull();
  });
});

describe("my selection", () => {
  it("is the options I am among the voters of, in the poll's order", () => {
    expect(mySelection(single, "maya")).toEqual([1]);
    expect(mySelection(multiple, "maya")).toEqual([1, 2]);
    expect(mySelection(multiple, "elif")).toEqual([]);
    expect(mySelection(multiple, undefined)).toEqual([]);
  });
});

describe("the selection a press sends", () => {
  it("moves a single choice, and takes it back on my own option", () => {
    expect(nextSelection(single, [1], 2)).toEqual([2]);
    expect(nextSelection(single, [], 3)).toEqual([3]);
    expect(nextSelection(single, [1], 1)).toEqual([]);
  });

  it("adds or removes one of several, in the poll's order", () => {
    expect(nextSelection(multiple, [1, 2], 2)).toEqual([1]);
    expect(nextSelection(multiple, [3], 1)).toEqual([1, 3]);
    expect(nextSelection(multiple, [1, 3], 2)).toEqual([1, 2, 3]);
    expect(nextSelection(multiple, [1], 1)).toEqual([]);
  });
});

describe("results", () => {
  it("counts, and draws bars as a share of the people who voted", () => {
    const results = pollResults(single, "maya");
    expect(results.map((r) => [r.votes, r.ratio, r.mine])).toEqual([
      [3, 3 / 6, true],
      [2, 2 / 6, false],
      [1, 1 / 6, false],
    ]);
  });

  it("lets the bars of several choices add up past one", () => {
    // Five people, nine votes: Pizza's bar is four of the five.
    const results = pollResults(multiple, "maya");
    expect(multiple.voterCount).toBe(5);
    expect(results.map((r) => r.ratio)).toEqual([4 / 5, 3 / 5, 2 / 5, 0]);
    expect(results.reduce((sum, r) => sum + r.ratio, 0)).toBeGreaterThan(1);
  });

  it("has empty bars and no leader when nobody voted", () => {
    const none = makePoll([
      { id: 1, text: "I will", voters: [] },
      { id: 2, text: "Not me", voters: [] },
    ]);
    expect(pollResults(none, "maya").map((r) => [r.ratio, r.leading])).toEqual([
      [0, false],
      [0, false],
    ]);
  });

  it("marks every option on the top count as leading", () => {
    const tie = makePoll([
      { id: 1, text: "Pizza", voters: [maya, jun] },
      { id: 2, text: "Dumplings", voters: [priya, tomas] },
      { id: 3, text: "Tacos", voters: [elif] },
    ]);
    expect(pollResults(tie, "maya").map((r) => r.leading)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("the outcome a closed poll shows", () => {
  const closed = (voters: (typeof maya)[][]) =>
    makePoll(
      voters.map((who, index) => ({
        id: index + 1,
        text: `Option ${index + 1}`,
        voters: who,
      })),
      { closed: true },
    );
  const outcome = (poll: Poll) => outcomeOf(poll, pollResults(poll, "maya"));

  it("is a winner, a tie, or nothing when nobody voted", () => {
    expect(outcome(closed([[maya, jun], [sam]]))).toBe("winner");
    expect(outcome(closed([[maya], [sam], []]))).toBe("tied");
    expect(outcome(closed([[], []]))).toBeNull();
  });

  it("is nothing while the poll is open", () => {
    expect(outcome(single)).toBeNull();
  });
});

describe("labels", () => {
  it("counts votes and voters", () => {
    expect(votesLabel(0)).toBe("0 votes");
    expect(votesLabel(1)).toBe("1 vote");
    expect(votesLabel(14)).toBe("14 votes");
    expect(votersLabel(0)).toBe("Nobody voted");
    expect(votersLabel(1)).toBe("1 person voted");
    expect(votersLabel(6)).toBe("6 people voted");
  });

  it("names up to three voters, me as You first, then counts the rest", () => {
    const ids = (shown: ReturnType<typeof votersShown>) => ({
      you: shown.you,
      named: shown.named.map((voter) => voter.id),
      others: shown.others,
    });
    expect(ids(votersShown([jun, sam, maya], "maya"))).toEqual({
      you: true,
      named: ["jun", "sam"],
      others: 0,
    });
    expect(ids(votersShown([jun, sam, elif], "maya"))).toEqual({
      you: false,
      named: ["jun", "sam", "elif"],
      others: 0,
    });
    expect(ids(votersShown([jun, maya, sam, priya], "maya"))).toEqual({
      you: true,
      named: ["jun"],
      others: 2,
    });
    expect(ids(votersShown([priya, tomas, jun, sam, elif], "maya"))).toEqual({
      you: false,
      named: ["priya", "tomas"],
      others: 3,
    });
    expect(ids(votersShown([], "maya"))).toEqual({
      you: false,
      named: [],
      others: 0,
    });
  });
});

describe("who may act on a poll", () => {
  const may = (
    message: Message,
    who: { myUserId?: string; inSpace?: boolean; mod?: boolean; pin?: boolean },
  ) =>
    pollPermissions({
      message,
      myUserId: who.myUserId,
      inSpace: who.inSpace ?? true,
      canModerate: who.mod ?? false,
      canPin: who.pin ?? false,
    });
  const open = rowOf(single, "jun");
  const shut = rowOf(makePoll([], { closed: true }), "jun");

  it("lets the author close and delete, and pins by the place's rule", () => {
    expect(may(open, { myUserId: "jun" })).toEqual({
      close: true,
      delete: true,
      pin: false,
    });
    expect(may(open, { myUserId: "casey", mod: true, pin: true })).toEqual({
      close: true,
      delete: true,
      pin: true,
    });
    expect(may(open, { myUserId: "sam" })).toEqual({
      close: false,
      delete: false,
      pin: false,
    });
  });

  it("closes nothing twice, though a closed poll is still deleted", () => {
    expect(may(shut, { myUserId: "jun" })).toEqual({
      close: false,
      delete: true,
      pin: false,
    });
  });

  it("leaves a conversation to the author alone, with no pins", () => {
    expect(
      may(open, { myUserId: "sam", inSpace: false, mod: true, pin: true }),
    ).toEqual({ close: false, delete: false, pin: false });
    expect(may(open, { myUserId: "jun", inSpace: false, pin: true })).toEqual({
      close: true,
      delete: true,
      pin: false,
    });
  });

  it("offers nothing on a deleted poll or another row", () => {
    expect(
      may({ ...open, deleted: true }, { myUserId: "jun", mod: true }),
    ).toEqual({ close: false, delete: false, pin: false });
    expect(
      may(create(MessageSchema, { content: "hi" }), { myUserId: "jun" }),
    ).toEqual({ close: false, delete: false, pin: false });
  });
});

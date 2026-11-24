import { create } from "@bufbuild/protobuf";
import { type Message, MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingVote, pressPollOption } from "./pendingVotes";

vi.mock("react-native", () => ({ AccessibilityInfo: { announceForAccessibility: vi.fn() } }));

// A poll of one choice, the reader ("me") having chosen option 1.
const poll = (): Message =>
  create(MessageSchema, {
    id: "p1",
    channelId: "c1",
    event: {
      kind: {
        case: "poll",
        value: {
          question: "Friday?",
          options: [
            { id: 1, text: "A", voters: [{ id: "me" }] },
            { id: 2, text: "B" },
          ],
          voterCount: 1,
        },
      },
    },
  });

// A vote whose answer the test settles by hand.
function held() {
  let settle: (err?: Error) => void = () => {};
  const vote = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = (err) => (err ? reject(err) : resolve());
      }),
  );
  return { vote, settle: (err?: Error) => settle(err) };
}

describe("pressPollOption", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the whole selection the press makes, and holds it until the answer", async () => {
    const { vote, settle } = held();
    const pressed = pressPollOption(vote, poll(), 2, "me");
    expect(vote).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), [2]);
    expect(pendingVote("p1")).toBe(2);
    settle();
    await pressed;
    expect(pendingVote("p1")).toBeNull();
  });

  it("takes back the reader's own option with an empty selection", async () => {
    const { vote, settle } = held();
    const pressed = pressPollOption(vote, poll(), 1, "me");
    expect(vote).toHaveBeenCalledWith(expect.anything(), []);
    settle();
    await pressed;
  });

  it("ignores a second press while a vote on the poll is out", async () => {
    const { vote, settle } = held();
    const first = pressPollOption(vote, poll(), 2, "me");
    await pressPollOption(vote, poll(), 1, "me");
    expect(vote).toHaveBeenCalledTimes(1);
    expect(pendingVote("p1")).toBe(2);
    settle();
    await first;
  });

  it("clears the pending vote on a refusal and passes the refusal on", async () => {
    const { vote, settle } = held();
    const pressed = pressPollOption(vote, poll(), 2, "me");
    settle(new Error("the poll is closed"));
    await expect(pressed).rejects.toThrow("the poll is closed");
    expect(pendingVote("p1")).toBeNull();
    // and the next press is taken
    const again = held();
    const next = pressPollOption(again.vote, poll(), 2, "me");
    expect(again.vote).toHaveBeenCalledTimes(1);
    again.settle();
    await next;
  });
});

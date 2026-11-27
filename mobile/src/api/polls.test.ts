import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it, vi } from "vitest";
import { chatClient } from "./clients";
import { createPoll, createTimePoll } from "./polls";

vi.mock("./clients", () => ({ chatClient: vi.fn() }));

const answered = () => {
  const createPollRpc = vi.fn(async (_request: object) => ({ message: create(MessageSchema, { id: "m1" }) }));
  vi.mocked(chatClient).mockReturnValue({ createPoll: createPollRpc } as never);
  return createPollRpc;
};

describe("creating a poll", () => {
  it("sends a time poll's times and no options", async () => {
    const rpc = answered();
    const times = [timestampFromDate(new Date("2030-01-04T19:00:00Z"))];
    const message = await createTimePoll("https://s", "t1", "c1", "Game night?", times, true);
    expect(message.id).toBe("m1");
    expect(chatClient).toHaveBeenCalledWith("https://s", "t1");
    expect(rpc).toHaveBeenCalledWith({ channelId: "c1", question: "Game night?", times, multiple: true });
    expect(rpc.mock.calls[0][0]).not.toHaveProperty("options");
  });

  it("sends a text poll's options and no times", async () => {
    const rpc = answered();
    await createPoll("https://s", "t1", "c1", "Pizza?", ["A", "B"], false);
    expect(rpc).toHaveBeenCalledWith({ channelId: "c1", question: "Pizza?", options: ["A", "B"], multiple: false });
    expect(rpc.mock.calls[0][0]).not.toHaveProperty("times");
  });
});

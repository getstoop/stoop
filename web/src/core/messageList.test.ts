import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageSchema,
  ReplyRefSchema,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import { ReactionSchema } from "../gen/stoop/chat/v1/reaction_pb";
import {
  withMessage,
  withoutMessage,
  withReactions,
  withReplaced,
  withRootDeleted,
} from "./messageList";

const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message => create(MessageSchema, { id, content: id, ...init });

const quote = (messageId: string) =>
  create(ReplyRefSchema, {
    messageId,
    author: { id: "ada", username: "ada" },
    preview: "the quoted words",
  });

const ids = (list: Message[]) => list.map((cached) => cached.id);

describe("withMessage", () => {
  it("adds a message at the end", () => {
    const list = [message("01")];
    expect(ids(withMessage(list, message("02")))).toEqual(["01", "02"]);
  });

  // The send's reply and the realtime event both deliver it.
  it("hands back the same list when the message is already there", () => {
    const list = [message("01"), message("02")];
    expect(withMessage(list, message("02"))).toBe(list);
  });
});

describe("withReplaced", () => {
  it("swaps in the new version", () => {
    const list = [message("01"), message("02")];
    const edited = message("02", { content: "edited" });
    expect(withReplaced(list, edited).map((cached) => cached.content)).toEqual([
      "01",
      "edited",
    ]);
  });

  it("keeps the reader's own half of the thread summary", () => {
    const list = [
      message("01", {
        thread: create(ThreadSummarySchema, {
          replyCount: 2,
          participating: true,
          muted: true,
          unreadCount: 1,
        }),
      }),
    ];
    const edited = message("01", {
      thread: create(ThreadSummarySchema, { replyCount: 3 }),
    });
    const thread = withReplaced(list, edited)[0].thread;
    expect(thread?.replyCount).toBe(3);
    expect(thread?.participating).toBe(true);
    expect(thread?.muted).toBe(true);
    expect(thread?.unreadCount).toBe(1);
  });
});

describe("withoutMessage", () => {
  it("drops the message and blanks quotes of it", () => {
    const list = [
      message("01"),
      message("02", { replyTo: quote("01") }),
      message("03", { replyTo: quote("02") }),
    ];
    const after = withoutMessage(list, "01");
    expect(ids(after)).toEqual(["02", "03"]);
    expect(after[0].replyTo?.author).toBeUndefined();
    expect(after[0].replyTo?.preview).toBe("");
    expect(after[1].replyTo?.preview).toBe("the quoted words");
  });

  it("takes a root's replies with it", () => {
    const list = [
      message("01"),
      message("02", { threadRootId: "01", inChannel: true }),
      message("03"),
    ];
    expect(ids(withoutMessage(list, "01"))).toEqual(["03"]);
  });
});

describe("withRootDeleted", () => {
  it("blanks quotes of the root and the line on its replies", () => {
    const list = [
      message("01", { deleted: true }),
      message("02", { replyTo: quote("01") }),
      message("03", { threadRoot: quote("01"), threadRootId: "01" }),
      message("04", { replyTo: quote("02") }),
    ];
    const after = withRootDeleted(list, "01");
    expect(ids(after)).toEqual(["01", "02", "03", "04"]);
    expect(after[1].replyTo?.preview).toBe("");
    expect(after[2].threadRoot?.author).toBeUndefined();
    expect(after[2].threadRoot?.preview).toBe("");
    expect(after[3].replyTo?.preview).toBe("the quoted words");
  });
});

describe("withReactions", () => {
  it("swaps one message's reactions for the server's list", () => {
    const thumbs = create(ReactionSchema, { emoji: "👍", userIds: ["ada"] });
    const list = [message("01"), message("02")];
    const after = withReactions(list, "02", [thumbs]);
    expect(after[0].reactions).toEqual([]);
    expect(after[1].reactions).toEqual([thumbs]);
  });
});

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { messagePreview } from "./messagePreview";

const message = (
  content: string,
  attachments: { name: string; expired?: boolean }[] = [],
) => create(MessageSchema, { content, attachments });

describe("messagePreview", () => {
  it("is the words on one line, markup dropped", () => {
    expect(
      messagePreview(message("**Who's** bringing\nthe second copy?")),
    ).toBe("Who's bringing the second copy?");
  });

  it("names the first file when there are no words", () => {
    expect(
      messagePreview(message("", [{ name: "cover.jpg" }, { name: "b.pdf" }])),
    ).toBe("📎 cover.jpg");
  });

  it("says when that file has expired", () => {
    expect(
      messagePreview(message("", [{ name: "cover.jpg", expired: true }])),
    ).toBe("📎 Expired attachment");
  });

  it("prefers the words to a file", () => {
    expect(
      messagePreview(message("see attached", [{ name: "cover.jpg" }])),
    ).toBe("see attached");
  });

  it("is empty with neither", () => {
    expect(messagePreview(message(""))).toBe("");
  });
});

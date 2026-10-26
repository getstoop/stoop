import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AttachmentSchema, MessageAuthorSchema, MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it } from "vitest";
import { pageLabel, positionText, viewerItems } from "./items";

const file = (name: string, contentType: string, expired = false) =>
  create(AttachmentSchema, { fileId: name, name, contentType, size: 1000n, expired });
const NOW = new Date(2026, 9, 26, 15, 0);
const message = (id: string, attachments: ReturnType<typeof file>[], at: Date = NOW) =>
  create(MessageSchema, {
    id,
    attachments,
    createdAt: timestampFromDate(at),
    author: create(MessageAuthorSchema, { displayName: "Theo Kim", username: "theo" }),
  });

describe("viewerItems", () => {
  it("walks every message's images, oldest first, each with its message", () => {
    const items = viewerItems([
      message("a", [file("one.jpg", "image/jpeg"), file("notes.pdf", "application/pdf")]),
      message("b", []),
      message("c", [file("two.png", "image/png"), file("three.webp", "image/webp")]),
    ]);
    expect(items.map((item) => [item.message.id, item.attachment.name])).toEqual([
      ["a", "one.jpg"],
      ["c", "two.png"],
      ["c", "three.webp"],
    ]);
  });

  it("takes videos in their place and leaves out expired files", () => {
    const items = viewerItems([
      message("a", [
        file("gone.jpg", "image/jpeg", true),
        file("clip.mp4", "video/mp4"),
        file("kept.jpg", "image/jpeg"),
      ]),
    ]);
    expect(items.map((item) => item.attachment.name)).toEqual(["clip.mp4", "kept.jpg"]);
  });
});

describe("pageLabel", () => {
  it("reads the name, the place, the sender and the time", () => {
    const [, second] = viewerItems([
      message("a", [file("IMG_2040.jpg", "image/jpeg"), file("IMG_2041.jpg", "image/jpeg")], new Date(2026, 9, 26, 9, 31)),
    ]);
    expect(pageLabel(second, 1, 4, NOW)).toMatch(/^IMG_2041\.jpg, image 2 of 4, from Theo Kim, 9:31\sAM$/);
  });

  it("says the day for an older one", () => {
    const [item] = viewerItems([message("a", [file("old.jpg", "image/jpeg")], new Date(2026, 9, 20, 9, 31))]);
    expect(pageLabel(item, 0, 1, NOW)).toMatch(/^old\.jpg, image 1 of 1, from Theo Kim, .+ at 9:31\sAM$/);
  });

  it("says a video is one", () => {
    const [item] = viewerItems([message("a", [file("clip.mov", "video/quicktime")], new Date(2026, 9, 26, 9, 31))]);
    expect(pageLabel(item, 0, 2, NOW)).toMatch(/^clip\.mov, video 1 of 2, from Theo Kim, 9:31\sAM$/);
  });

  it("counts from one", () => {
    expect(positionText(0, 3)).toBe("1 of 3");
  });
});

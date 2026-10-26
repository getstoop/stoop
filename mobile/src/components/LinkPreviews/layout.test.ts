import { create } from "@bufbuild/protobuf";
import { LinkPreviewSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it } from "vitest";
import { markdown } from "../../theme/generated";
import { cardLayout } from "./layout";

const preview = (fields: Parameters<typeof create<typeof LinkPreviewSchema>>[1]) =>
  create(LinkPreviewSchema, { url: "https://example.com", ...fields });

// The words' width in a row on a 402pt-wide phone (BODY_INSETS.row).
const BODY = 402 - 78;
// A text card's room for its image there: less its padding and bar.
const ROOM = BODY - 2 * markdown.previewPadX - markdown.previewBarWidth;

// Sizes checked against Chromium drawing link-previews.css: a wide image
// under the words fills the card's width whatever its own size, its
// height by its shape up to the cap; an image alone and squarish stays
// its own size.
describe("cardLayout", () => {
  it("draws no image without one", () => {
    expect(cardLayout(preview({ title: "T" }), BODY)).toEqual({ imageOnly: false, landscape: true });
  });

  it("puts a squarish image beside the words as the thumbnail", () => {
    const layout = cardLayout(preview({ title: "T", imageFileId: "f", imageWidth: 600, imageHeight: 600 }), BODY);
    expect(layout).toEqual({
      imageOnly: false,
      landscape: false,
      image: { width: markdown.previewThumbSize, height: markdown.previewThumbSize },
    });
  });

  it("stretches a wide image under the words to the card's room, small ones too", () => {
    const big = cardLayout(preview({ title: "T", imageFileId: "f", imageWidth: 1200, imageHeight: 630 }), BODY);
    expect(big.landscape).toBe(true);
    expect(big.image).toEqual({ width: ROOM, height: Math.floor((ROOM * 630) / 1200) });
    const small = cardLayout(preview({ title: "T", imageFileId: "f", imageWidth: 64, imageHeight: 32 }), BODY);
    expect(small.image).toEqual({ width: ROOM, height: Math.floor(ROOM / 2) });
  });

  it("caps the card at its width and the image at its height", () => {
    const layout = cardLayout(preview({ title: "T", imageFileId: "f", imageWidth: 2000, imageHeight: 1500 }), 2000);
    const room = markdown.previewMaxWidth - 2 * markdown.previewPadX - markdown.previewBarWidth;
    expect(layout.image).toEqual({ width: room, height: markdown.previewImageMaxHeight });
  });

  it("is the image alone without a title: a wide one stretched to its cap, any other its own size", () => {
    const wide = cardLayout(preview({ imageFileId: "f", imageWidth: 64, imageHeight: 32 }), 1000);
    expect(wide).toEqual({
      imageOnly: true,
      landscape: true,
      image: { width: markdown.previewImageOnlyMaxWidth, height: markdown.previewImageOnlyMaxWidth / 2 },
    });
    const small = cardLayout(preview({ imageFileId: "f", imageWidth: 60, imageHeight: 64 }), BODY);
    expect(small.image).toEqual({ width: 60, height: 64 });
    const tall = cardLayout(preview({ imageFileId: "f", imageWidth: 800, imageHeight: 1600 }), BODY);
    expect(tall.image).toEqual({ width: BODY, height: BODY * 2 });
  });

  it("draws an image of unknown size as the thumbnail", () => {
    const layout = cardLayout(preview({ title: "T", imageFileId: "f" }), BODY);
    expect(layout.landscape).toBe(false);
    expect(layout.image).toEqual({ width: markdown.previewThumbSize, height: markdown.previewThumbSize });
  });
});

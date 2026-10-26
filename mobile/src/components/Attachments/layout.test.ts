import { create } from "@bufbuild/protobuf";
import { AttachmentSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it } from "vitest";
import { markdown } from "../../theme/generated";
import { attachmentsLayout } from "./layout";
import { downloadedText } from "./words";

let next = 0;
const file = (fields: Parameters<typeof create<typeof AttachmentSchema>>[1]) =>
  create(AttachmentSchema, { fileId: `f${next++}`, name: "file", size: 1000n, ...fields });
const photo = (width: number, height: number) => file({ contentType: "image/jpeg", width, height });

// The words' width in a row on a 390pt-wide phone (BODY_INSETS.row).
const BODY = 390 - 78;

describe("attachmentsLayout", () => {
  it("fits one image to the row's width and 320 high, never enlarged", () => {
    const [landscape] = attachmentsLayout([photo(4032, 3024)], BODY);
    expect(landscape).toMatchObject({ kind: "image", box: { width: 312, height: 234 }, fit: "cover" });
    const [portrait] = attachmentsLayout([photo(3024, 4032)], BODY);
    expect(portrait).toMatchObject({ box: { width: 240, height: 320 } });
    const [small] = attachmentsLayout([photo(200, 100)], BODY);
    expect(small).toMatchObject({ box: { width: 200, height: 100 } });
  });

  it("stops at web's 420 on a wide screen", () => {
    const [wide] = attachmentsLayout([photo(4000, 1000)], 1000);
    expect(wide).toMatchObject({ box: { width: markdown.attachmentImageMaxWidth, height: 105 } });
  });

  it("gives an image of unknown size the fixed 4:3 box, the image inside it", () => {
    const [unknown] = attachmentsLayout([photo(0, 0)], BODY);
    expect(unknown).toMatchObject({ box: { width: 312, height: 234 }, fit: "scale-down" });
  });

  it("keeps a strip 44 on its short side, cropped, and a tiny image its size", () => {
    const [wide] = attachmentsLayout([photo(4000, 20)], BODY);
    expect(wide).toMatchObject({ box: { width: 312, height: 44 }, fit: "cover" });
    const [tall] = attachmentsLayout([photo(20, 4000)], BODY);
    expect(tall).toMatchObject({ box: { width: 44, height: 320 }, fit: "cover" });
    const [tiny] = attachmentsLayout([photo(16, 16)], BODY);
    expect(tiny).toMatchObject({ box: { width: 44, height: 44 }, fit: "scale-down" });
  });

  it("puts two or more images in a grid of square tiles, then the other files in order", () => {
    const images = [photo(10, 10), photo(0, 0), photo(30, 20)];
    const pdf = file({ contentType: "application/pdf" });
    const gone = file({ contentType: "image/png", expired: true });
    const parts = attachmentsLayout([pdf, images[0], gone, images[1], images[2]], BODY);
    expect(parts).toEqual([
      { kind: "grid", attachments: images, tile: 152 },
      { kind: "card", attachment: pdf },
      { kind: "expired", attachment: gone },
    ]);
  });

  it("keeps one image among other files in its place", () => {
    const pdf = file({ contentType: "application/pdf" });
    const image = photo(100, 100);
    expect(attachmentsLayout([pdf, image], BODY).map((part) => part.kind)).toEqual(["card", "image"]);
  });

  it("draws video and audio as cards for now", () => {
    const parts = attachmentsLayout(
      [file({ contentType: "video/mp4" }), file({ contentType: "audio/mpeg" }), photo(10, 10)],
      BODY,
    );
    expect(parts.map((part) => part.kind)).toEqual(["card", "card", "image"]);
  });
});

describe("downloadedText", () => {
  it("counts in the file's unit", () => {
    expect(downloadedText(1.1 * 1024 * 1024, 2.4 * 1024 * 1024)).toBe("1.1 of 2.4 MB");
    expect(downloadedText(9e9, BigInt(2 * 1024 * 1024))).toBe("2.0 of 2.0 MB");
  });

  it("only says it is going for a small file or before the first bytes", () => {
    expect(downloadedText(100, 500_000)).toBe("Downloading…");
    expect(downloadedText(0, 5 * 1024 * 1024)).toBe("Downloading…");
  });
});

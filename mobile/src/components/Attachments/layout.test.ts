import { create } from "@bufbuild/protobuf";
import { AttachmentSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it } from "vitest";
import { markdown } from "../../theme/generated";
import { attachmentsLayout } from "./layout";
import { audioTime, clock, downloadedText } from "./words";

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

  it("gives a side under 44 a 44 box, never enlarging the image to fill it", () => {
    // Shrunk below 44: cropped to fill, which still shrinks it.
    const [shrunk] = attachmentsLayout([photo(4000, 100)], BODY);
    expect(shrunk).toMatchObject({ box: { width: 312, height: 44 }, fit: "cover" });
    const [tall] = attachmentsLayout([photo(100, 4000)], BODY);
    expect(tall).toMatchObject({ box: { width: 44, height: 320 }, fit: "cover" });
    // Under 44 of its own: drawn at its own size inside the box.
    const [strip] = attachmentsLayout([photo(200, 30)], BODY);
    expect(strip).toMatchObject({ box: { width: 200, height: 44 }, fit: "scale-down" });
    const [thin] = attachmentsLayout([photo(4000, 20)], BODY);
    expect(thin).toMatchObject({ box: { width: 312, height: 44 }, fit: "scale-down" });
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

  it("draws one video as web's 280 frame in a fixed 16:9 box", () => {
    const clip = file({ contentType: "video/quicktime" });
    expect(attachmentsLayout([clip], BODY)).toEqual([
      { kind: "video", attachment: clip, box: { width: 280, height: 158 } },
    ]);
    const [narrow] = attachmentsLayout([clip], 240);
    expect(narrow).toMatchObject({ box: { width: 240, height: 135 } });
  });

  it("puts a video in the grid with the images, in their order", () => {
    const clip = file({ contentType: "video/mp4" });
    const image = photo(100, 100);
    const pdf = file({ contentType: "application/pdf" });
    expect(attachmentsLayout([clip, pdf, image], BODY)).toEqual([
      { kind: "grid", attachments: [clip, image], tile: 152 },
      { kind: "card", attachment: pdf },
    ]);
  });

  it("draws audio as a player as wide as the words, no wider than web's 480, in its place", () => {
    const note = file({ contentType: "audio/mp4" });
    const images = [photo(10, 10), photo(20, 20)];
    expect(attachmentsLayout([note, ...images], BODY)).toEqual([
      { kind: "grid", attachments: images, tile: 152 },
      { kind: "audio", attachment: note, width: BODY },
    ]);
    expect(attachmentsLayout([note], 1000)).toEqual([
      { kind: "audio", attachment: note, width: markdown.attachmentMediaMaxWidth },
    ]);
  });

  it("draws an audio file this phone can't play as a card", () => {
    const note = file({ contentType: "audio/ogg" });
    expect(attachmentsLayout([note], BODY, new Set([note.fileId]))).toEqual([{ kind: "card", attachment: note }]);
  });

  it("draws a video this phone can't play as a card, out of the grid", () => {
    const clip = file({ contentType: "video/webm" });
    const image = photo(100, 100);
    const unplayable = new Set([clip.fileId]);
    expect(attachmentsLayout([clip], BODY, unplayable)).toEqual([{ kind: "card", attachment: clip }]);
    expect(attachmentsLayout([clip, image], BODY, unplayable).map((part) => part.kind)).toEqual(["card", "image"]);
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

describe("audioTime", () => {
  it("shows the length at rest and the position against it once started", () => {
    expect(audioTime(false, 0, 72.4)).toBe("1:12");
    expect(audioTime(true, 27.9, 72.4)).toBe("0:27 / 1:12");
    expect(audioTime(true, 71.5, 71.98)).toBe("1:11 / 1:12");
  });

  it("says 0:00 for a file never played, and the position alone while the length is unknown", () => {
    expect(audioTime(false, 0, 0)).toBe("0:00");
    expect(audioTime(true, 3.2, 0)).toBe("0:03");
  });

  it("counts hours past the hour", () => {
    expect(clock(605)).toBe("10:05");
    expect(clock(3729)).toBe("1:02:09");
    expect(clock(-1)).toBe("0:00");
  });
});

import { describe, expect, it } from "vitest";
import { restoreDraft, restoreFiles } from "./unsent";

const photo = {
  key: "photo",
  name: "photo.png",
  size: 10,
  contentType: "image/png",
  previewUrl: "blob:photo",
  fileId: "f1",
};
const notes = {
  key: "notes",
  name: "notes.txt",
  size: 5,
  contentType: "text/plain",
  fileId: "f2",
};

describe("restoreDraft", () => {
  it("gives the text back to an empty box", () => {
    expect(restoreDraft("see attached", "")).toBe("see attached");
  });

  it("keeps what was typed while the send was in flight", () => {
    expect(restoreDraft("see attached", "one more thing")).toBe(
      "see attached\none more thing",
    );
  });
});

describe("restoreFiles", () => {
  it("gives the files back with their previews", () => {
    expect(restoreFiles([photo], [])).toEqual([photo]);
  });

  it("keeps files added while the send was in flight", () => {
    expect(restoreFiles([photo], [notes])).toEqual([photo, notes]);
  });

  it("does not list a file twice", () => {
    expect(restoreFiles([photo], [photo])).toEqual([photo]);
  });
});

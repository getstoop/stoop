import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  AttachmentSchema,
  MessageSchema,
} from "../gen/stoop/chat/v1/message_pb";
import {
  attachmentKind,
  formatBytes,
  galleryMedia,
  isInlineImage,
  isPlayableVideo,
  restoreFiles,
  uploadSlots,
} from "./attachments";

const photo = { key: "photo", name: "photo.png", fileId: "f1" };
const notes = { key: "notes", name: "notes.txt", fileId: "f2" };

describe("restoreFiles", () => {
  it("gives the files back as they were", () => {
    expect(restoreFiles([photo], [])).toEqual([photo]);
  });

  it("puts them ahead of files added while the send was in flight", () => {
    expect(restoreFiles([photo], [notes])).toEqual([photo, notes]);
  });

  it("does not list a file twice", () => {
    expect(restoreFiles([photo], [photo])).toEqual([photo]);
  });
});

describe("uploadSlots", () => {
  // A task that runs until it is let go.
  function held() {
    let release = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { done, release };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs at most three at once and starts the next as one ends", async () => {
    const withSlot = uploadSlots();
    const tasks = [held(), held(), held(), held(), held()];
    const started: number[] = [];
    const runs = tasks.map((task, index) =>
      withSlot(async () => {
        started.push(index);
        await task.done;
        return index;
      }),
    );
    await settle();
    expect(started).toEqual([0, 1, 2]);
    tasks[1].release();
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);
    for (const task of tasks) task.release();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4]);
  });

  it("frees the slot of a task that fails", async () => {
    const withSlot = uploadSlots(1);
    const failing = withSlot(() => Promise.reject(new Error("refused")));
    const next = withSlot(() => Promise.resolve("ran"));
    await expect(failing).rejects.toThrow("refused");
    expect(await next).toBe("ran");
  });
});

describe("formatBytes", () => {
  it("counts bytes, then KB, then MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
    expect(formatBytes(BigInt(5 * 1024 * 1024))).toBe("5.0 MB");
  });
});

describe("inline types", () => {
  it("shows raster images and plays the browsers' videos", () => {
    expect(isInlineImage("image/jpeg")).toBe(true);
    expect(isInlineImage("image/heic")).toBe(false);
    expect(isPlayableVideo("video/quicktime")).toBe(true);
    expect(isPlayableVideo("application/octet-stream")).toBe(false);
  });
});

const file = (fileId: string, contentType: string, expired = false) =>
  create(AttachmentSchema, { fileId, name: fileId, contentType, expired });

describe("attachmentKind", () => {
  it("names how each file is drawn", () => {
    expect(attachmentKind(file("clip", "video/mp4"))).toBe("video");
    expect(attachmentKind(file("song", "audio/mpeg"))).toBe("audio");
    expect(attachmentKind(file("photo", "image/png"))).toBe("image");
    expect(attachmentKind(file("notes", "text/plain"))).toBe("file");
    expect(attachmentKind(file("raw", "image/heic"))).toBe("file");
  });

  it("puts expired ahead of the type it kept", () => {
    expect(attachmentKind(file("photo", "image/png", true))).toBe("expired");
    expect(attachmentKind(file("clip", "video/mp4", true))).toBe("expired");
  });
});

describe("galleryMedia", () => {
  it("lists the images and videos of every message, oldest first", () => {
    const messages = [
      create(MessageSchema, {
        id: "m1",
        attachments: [
          file("photo", "image/jpeg"),
          file("notes", "application/pdf"),
          file("gone", "image/png", true),
        ],
      }),
      create(MessageSchema, { id: "m2" }),
      create(MessageSchema, {
        id: "m3",
        attachments: [file("song", "audio/ogg"), file("clip", "video/webm")],
      }),
    ];
    expect(galleryMedia(messages).map((media) => media.fileId)).toEqual([
      "photo",
      "clip",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  attachmentRetentionMoot,
  historyRetentionNote,
  retentionConfirmBody,
  shortens,
} from "./retention";

describe("historyRetentionNote", () => {
  it("says nothing while messages are kept forever", () => {
    expect(historyRetentionNote(0)).toBe("");
  });
  it("names the period", () => {
    expect(historyRetentionNote(90)).toBe(
      "messages older than 90 days are deleted",
    );
    expect(historyRetentionNote(1)).toBe(
      "messages older than 1 day are deleted",
    );
  });
});

describe("shortens", () => {
  it("asks when turning retention on or shortening it", () => {
    expect(shortens(0, 30)).toBe(true);
    expect(shortens(90, 30)).toBe(true);
  });
  it("doesn't ask when keeping longer, the same, or forever", () => {
    expect(shortens(30, 90)).toBe(false);
    expect(shortens(30, 30)).toBe(false);
    expect(shortens(30, 0)).toBe(false);
  });
});

describe("attachmentRetentionMoot", () => {
  it("is moot only when messages go first", () => {
    expect(attachmentRetentionMoot(30, 90)).toBe(true);
    expect(attachmentRetentionMoot(30, 30)).toBe(true);
    expect(attachmentRetentionMoot(90, 30)).toBe(false);
    expect(attachmentRetentionMoot(0, 30)).toBe(false);
  });
});

describe("retentionConfirmBody", () => {
  it("counts both settings", () => {
    expect(
      retentionConfirmBody(
        { messages: 12406n, attachments: 1n },
        90,
        30,
        "2.0 KB",
      ),
    ).toBe(
      "Within the hour, the server will permanently delete 12,406 messages older than 90 days and 1 attachment older than 30 days (2.0 KB). Pinned messages and their files are kept. This can't be undone.",
    );
  });
  it("leaves out a setting that keeps forever", () => {
    expect(
      retentionConfirmBody({ messages: 0n, attachments: 0n }, 7, 0, "0 B"),
    ).toBe(
      "Within the hour, the server will permanently delete 0 messages older than 7 days. Pinned messages and their files are kept. This can't be undone.",
    );
  });
});

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  MessageAuthorSchema,
  MessageSchema,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import { mutedOverlay, namesMe, viewerHalfAfter } from "./threadUnread";

const root = (init: MessageInitShape<typeof MessageSchema> = {}) => {
  const made = create(MessageSchema, init);
  made.id = "root";
  made.author ??= create(MessageAuthorSchema, { id: "them" });
  return made;
};
const summary = (
  replyCount: number,
  lastBy: string,
  half: { participating?: boolean; muted?: boolean; unreadCount?: number } = {},
) =>
  create(ThreadSummarySchema, {
    replyCount,
    recentAuthors: [{ id: lastBy }],
    ...half,
  });

describe("viewerHalfAfter", () => {
  it("counts a first reply on my own message", () => {
    expect(
      viewerHalfAfter(
        root({ author: { id: "me" } }),
        summary(1, "dee"),
        "me",
        false,
      ),
    ).toEqual({ participating: true, muted: false, unreadCount: 1 });
  });

  it("counts a first reply where I was named, not where @channel was", () => {
    const named = root({ mentionUserIds: ["me"] });
    expect(
      viewerHalfAfter(named, summary(1, "dee"), "me", false).unreadCount,
    ).toBe(1);
    const everyone = root({
      mentionUserIds: ["me"],
      mentionsEntireChannel: true,
    });
    expect(
      viewerHalfAfter(everyone, summary(1, "dee"), "me", false).unreadCount,
    ).toBe(0);
  });

  it("adds others' replies, not mine, and joins me when I reply", () => {
    const held = root({
      thread: summary(2, "dee", { participating: true, unreadCount: 1 }),
    });
    expect(
      viewerHalfAfter(held, summary(4, "dee"), "me", false).unreadCount,
    ).toBe(3);
    expect(
      viewerHalfAfter(held, summary(3, "me"), "me", false).unreadCount,
    ).toBe(1);
    const outside = root({ thread: summary(2, "dee") });
    expect(
      viewerHalfAfter(outside, summary(3, "me"), "me", false).participating,
    ).toBe(true);
  });

  it("counts me in when a reply named me", () => {
    const outside = root({ thread: summary(2, "dee") });
    expect(
      viewerHalfAfter(outside, summary(3, "dee"), "me", false).unreadCount,
    ).toBe(0);
    expect(viewerHalfAfter(outside, summary(3, "dee"), "me", true)).toEqual({
      participating: true,
      muted: false,
      unreadCount: 1,
    });
  });

  it("counts nothing in a muted thread, and never more than the replies left", () => {
    const muted = root({
      thread: summary(2, "dee", { participating: true, muted: true }),
    });
    expect(viewerHalfAfter(muted, summary(3, "dee"), "me", false)).toEqual({
      participating: true,
      muted: true,
      unreadCount: 0,
    });
    const after = root({
      thread: summary(3, "dee", { participating: true, unreadCount: 3 }),
    });
    expect(
      viewerHalfAfter(after, summary(2, "dee"), "me", false).unreadCount,
    ).toBe(2);
  });
});

describe("namesMe", () => {
  it("is a reply naming me, not @here or a top-level message", () => {
    const reply = { threadRootId: "root", mentionUserIds: ["me"] };
    expect(namesMe(create(MessageSchema, reply), "me")).toBe(true);
    expect(
      namesMe(create(MessageSchema, { ...reply, mentionsHere: true }), "me"),
    ).toBe(false);
    expect(
      namesMe(create(MessageSchema, { mentionUserIds: ["me"] }), "me"),
    ).toBe(false);
    expect(namesMe(create(MessageSchema, reply), undefined)).toBe(false);
  });
});

describe("mutedOverlay", () => {
  it("clears the count on muting and leaves it on unmuting", () => {
    expect(mutedOverlay(true)).toEqual({ muted: true, unreadCount: 0 });
    expect(mutedOverlay(false)).toEqual({ muted: false });
  });
});

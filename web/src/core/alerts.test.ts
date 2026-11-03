import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type {
  Message,
  MessageAuthor,
  ReplyRef,
} from "../gen/stoop/chat/v1/message_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { addressesMe, alertingTotal } from "./alerts";

const space = (id: string, alertCount: number, muted = false): Space =>
  ({ id, alertCount, muted }) as Space;

const dm = (
  id: string,
  unreadCount: number,
  over: { muted?: boolean; closed?: boolean } = {},
): DirectMessage =>
  ({
    channel: {
      id,
      unreadCount,
      alertCount: 0,
      muted: over.muted ?? false,
    } as Channel,
    closed: over.closed ?? false,
  }) as DirectMessage;

const author = (id: string): MessageAuthor => ({ id }) as MessageAuthor;

const message = (over: Partial<Message> = {}): Message =>
  ({
    id: "m1",
    author: author("bea"),
    mentionUserIds: [],
    mentionsEntireChannel: false,
    mentionsHere: false,
    ...over,
  }) as Message;

describe("alertingTotal", () => {
  it("is zero with nothing loaded", () => {
    expect(alertingTotal(undefined, undefined)).toBe(0);
  });

  it("sums the spaces' counts", () => {
    expect(alertingTotal([space("s1", 2), space("s2", 60)], [])).toBe(62);
  });

  it("leaves a muted space out", () => {
    expect(alertingTotal([space("s1", 2), space("s2", 5, true)], [])).toBe(2);
  });

  it("counts a conversation once while it has unread messages", () => {
    expect(alertingTotal([], [dm("d1", 7), dm("d2", 1), dm("d3", 0)])).toBe(2);
  });

  it("skips a muted or closed conversation", () => {
    expect(
      alertingTotal(
        [],
        [dm("d1", 3, { muted: true }), dm("d2", 3, { closed: true })],
      ),
    ).toBe(0);
  });

  it("adds spaces and conversations together", () => {
    expect(alertingTotal([space("s1", 4)], [dm("d1", 2)])).toBe(5);
  });
});

describe("addressesMe", () => {
  it("names me", () => {
    expect(addressesMe(message({ mentionUserIds: ["ada"] }), "ada")).toBe(true);
    expect(addressesMe(message({ mentionUserIds: ["cal"] }), "ada")).toBe(
      false,
    );
  });

  it("reaches me through @channel and @here", () => {
    expect(addressesMe(message({ mentionsEntireChannel: true }), "ada")).toBe(
      true,
    );
    expect(addressesMe(message({ mentionsHere: true }), "ada")).toBe(true);
  });

  it("replies to a message of mine", () => {
    const reply = message({
      replyTo: { messageId: "m0", author: author("ada") } as ReplyRef,
    });
    expect(addressesMe(reply, "ada")).toBe(true);
    expect(addressesMe(reply, "cal")).toBe(false);
  });

  it("is never my own message, nor anyone's when I am unknown", () => {
    const own = message({ author: author("ada"), mentionUserIds: ["ada"] });
    expect(addressesMe(own, "ada")).toBe(false);
    expect(addressesMe(message({ mentionsHere: true }), undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  type Channel,
  ChannelPostPolicy,
} from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { threadRepliesClosed } from "./threadReplies";

const channel = (postPolicy: ChannelPostPolicy) =>
  ({ postPolicy }) as unknown as Channel;
const root = (deleted: boolean) => ({ deleted }) as unknown as Message;

describe("threadRepliesClosed", () => {
  it("takes replies in a channel everyone posts in", () => {
    expect(
      threadRepliesClosed(channel(ChannelPostPolicy.EVERYONE), root(false)),
    ).toBeNull();
  });

  it("takes them while the channel or the root is still loading", () => {
    expect(threadRepliesClosed(undefined, undefined)).toBeNull();
  });

  it("is closed in an announcement channel", () => {
    expect(
      threadRepliesClosed(channel(ChannelPostPolicy.ADMINS), root(false)),
    ).toBe("Replies are closed in announcement channels.");
  });

  it("is closed on a deleted root, which says so first", () => {
    const deleted =
      "The message this thread started from was deleted, so it takes no new replies.";
    expect(
      threadRepliesClosed(channel(ChannelPostPolicy.EVERYONE), root(true)),
    ).toBe(deleted);
    expect(
      threadRepliesClosed(channel(ChannelPostPolicy.ADMINS), root(true)),
    ).toBe(deleted);
  });
});

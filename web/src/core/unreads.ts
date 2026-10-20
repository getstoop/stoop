import type { Channel } from "../gen/stoop/chat/v1/channel_pb";

// Badge pills are narrow, and past a hundred the exact number stops
// telling you anything you'd act on.
export function badgeCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function isUnread(c: Channel): boolean {
  return c.lastMessageId !== "" && c.lastMessageId > c.lastReadMessageId;
}

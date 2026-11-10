import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationData } from "./content";
import { acceptTap, dropTap, onTap, pendingTap, TAP_WAIT_MS, takeTap } from "./pendingTap";

const tap = (serverId: string): NotificationData => ({
  serverId,
  itemId: "item",
  kind: ActivityKind.MENTION,
  spaceId: "space",
  channelId: "general",
  threadRootId: "",
  messageId: "m1",
});

let n = 0;
const key = () => `key-${n++}`;

describe("the pending tap", () => {
  beforeEach(dropTap);

  it("is taken once, by its own server", () => {
    const data = tap("a");
    acceptTap(key(), data, 0);
    expect(takeTap("b", 1)).toBeNull();
    expect(pendingTap(1)).toBe(data);
    expect(takeTap("a", 2)).toBe(data);
    expect(takeTap("a", 3)).toBeNull();
    expect(pendingTap(3)).toBeNull();
  });

  it("accepts a response once, however often it is reported", () => {
    const k = key();
    const heard = vi.fn();
    const off = onTap(heard);
    expect(acceptTap(k, tap("a"), 0)).toBe(true);
    expect(takeTap("a", 1)).not.toBeNull();
    expect(acceptTap(k, tap("a"), 2)).toBe(false);
    expect(pendingTap(2)).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    expect(acceptTap(key(), tap("a"), 3)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("gives way to a later tap", () => {
    acceptTap(key(), tap("a"), 0);
    const later = tap("b");
    acceptTap(key(), later, 1);
    expect(takeTap("a", 2)).toBeNull();
    expect(takeTap("b", 2)).toBe(later);
  });

  it("is dropped when nobody took it in time", () => {
    acceptTap(key(), tap("a"), 0);
    expect(pendingTap(TAP_WAIT_MS)).not.toBeNull();
    expect(takeTap("a", TAP_WAIT_MS + 1)).toBeNull();
    expect(pendingTap(1)).toBeNull();
  });
});

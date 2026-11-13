import { beforeEach, describe, expect, it, vi } from "vitest";
import { heardLink, LINK_WAIT_MS, onLink, takeLink } from "./pendingLink";
import type { SharedLink } from "./sharedLink";

const link = (channelId: string): SharedLink => ({
  origin: "https://chat.example.com",
  spaceId: "books",
  channelId,
  threadRootId: "",
  messageId: "",
});

describe("the pending link", () => {
  beforeEach(() => void takeLink());

  it("is taken once", () => {
    const heard = link("general");
    heardLink(heard, 0);
    expect(takeLink(1)).toBe(heard);
    expect(takeLink(2)).toBeNull();
  });

  it("is the last one heard", () => {
    heardLink(link("general"), 0);
    const second = link("random");
    heardLink(second, 1);
    expect(takeLink(2)).toBe(second);
  });

  it("is let go when nobody takes it in time", () => {
    heardLink(link("general"), 0);
    expect(takeLink(LINK_WAIT_MS + 1)).toBeNull();
    heardLink(link("general"), 0);
    expect(takeLink(LINK_WAIT_MS)).not.toBeNull();
  });

  it("tells whoever listens, until they stop", () => {
    const listener = vi.fn();
    const stop = onLink(listener);
    heardLink(link("general"));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    heardLink(link("general"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

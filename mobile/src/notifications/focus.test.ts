import { describe, expect, it, vi } from "vitest";
import { clearFocusedPlace, focusedPlace, onFocusedPlace, setFocusedPlace } from "./focus";

describe("the focused place", () => {
  it("stays the thread's when the channel under it clears after the thread has set", () => {
    const channel = { serverId: "a", channelId: "general" };
    const thread = { serverId: "a", channelId: "general", threadRootId: "root" };
    setFocusedPlace(channel);
    setFocusedPlace(thread);
    clearFocusedPlace(channel);
    expect(focusedPlace()).toBe(thread);
    clearFocusedPlace(thread);
    expect(focusedPlace()).toBeNull();
  });

  it("is told to whoever listens as it is set, and not as it clears", () => {
    const heard = vi.fn();
    const off = onFocusedPlace(heard);
    const channel = { serverId: "a", channelId: "general" };
    setFocusedPlace(channel);
    clearFocusedPlace(channel);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(channel);
    off();
    setFocusedPlace(channel);
    clearFocusedPlace(channel);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

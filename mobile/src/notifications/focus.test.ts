import { describe, expect, it } from "vitest";
import { clearFocusedPlace, focusedPlace, setFocusedPlace } from "./focus";

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
});

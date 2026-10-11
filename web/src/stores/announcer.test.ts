import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announce, useAnnouncerStore } from "./announcer";

const message = () => useAnnouncerStore.getState().message;

describe("announce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAnnouncerStore.setState({ message: "" });
  });
  afterEach(() => vi.useRealTimers());

  it("sets the message after emptying the region", () => {
    useAnnouncerStore.setState({ message: "#garden muted." });
    announce("#garden unmuted.");
    expect(message()).toBe("");
    vi.runAllTimers();
    expect(message()).toBe("#garden unmuted.");
  });

  it("says the same sentence again", () => {
    announce("#garden muted.");
    vi.runAllTimers();
    announce("#garden muted.");
    expect(message()).toBe("");
    vi.runAllTimers();
    expect(message()).toBe("#garden muted.");
  });

  it("keeps only the latest of two in a row", () => {
    announce("#garden muted.");
    announce("#porch muted.");
    vi.runAllTimers();
    expect(message()).toBe("#porch muted.");
  });
});

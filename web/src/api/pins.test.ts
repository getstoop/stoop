import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openChannel } from "./channelLog";
import { CHANNEL, id, logOf, resetServer } from "./channelLogTestServer";
import { invalidatePins, markPinned, pinsKey, setMessagePinned } from "./pins";

const { listMessages, listChanges, setPinned } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listChanges: vi.fn(),
  setPinned: vi.fn(),
}));
vi.mock("./clients", () => ({
  chatClient: { listMessages, listChanges, setMessagePinned: setPinned },
}));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));
vi.mock("../stores/dialogs", () => ({ notice: vi.fn() }));

const pinned = (messageId: string) => logOf().rows.get(messageId)?.pinned;

beforeEach(async () => {
  resetServer(listMessages, listChanges);
  setPinned.mockReset();
  await openChannel(CHANNEL);
});

describe("markPinned", () => {
  it("flips the flag on the held row at its seq", () => {
    const before = logOf().rows.get(id(390));
    markPinned(CHANNEL, id(390), true);
    const after = logOf().rows.get(id(390));
    expect(after?.pinned).toBe(true);
    expect(after?.seq).toBe(before?.seq);
    expect(pinned(id(391))).toBe(false);
  });

  it("leaves a channel that isn't held alone", () => {
    markPinned("elsewhere", "m1", true);
    expect(logOf().rows.get("m1")).toBeUndefined();
  });
});

describe("setMessagePinned", () => {
  it("marks before the server answers and drops the pin list after", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(pinsKey(CHANNEL), []);
    queryClient.setQueryData(pinsKey("other"), []);
    let answer: () => void = () => {};
    setPinned.mockImplementation(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    const message = logOf().rows.get(id(390));
    if (!message) throw new Error("no row");
    const pinning = setMessagePinned(queryClient, message, true);
    expect(pinned(id(390))).toBe(true);
    answer();
    await pinning;
    expect(queryClient.getQueryState(pinsKey(CHANNEL))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(pinsKey("other"))?.isInvalidated).toBe(
      false,
    );
  });

  it("takes the mark back when the server refuses", async () => {
    const queryClient = new QueryClient();
    setPinned.mockRejectedValue(new Error("no"));
    const message = logOf().rows.get(id(390));
    if (!message) throw new Error("no row");
    await setMessagePinned(queryClient, message, true);
    expect(pinned(id(390))).toBe(false);
  });
});

describe("invalidatePins", () => {
  it("drops the channel's list only", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(pinsKey(CHANNEL), []);
    queryClient.setQueryData(pinsKey("other"), []);
    invalidatePins(queryClient, CHANNEL);
    expect(queryClient.getQueryState(pinsKey(CHANNEL))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(pinsKey("other"))?.isInvalidated).toBe(
      false,
    );
  });
});

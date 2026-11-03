import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { noteAlert, refetchAlertsIfAny } from "./alerts";

// This module reaches ./unreads → ./dms → ./clients, which builds its
// transport from location.origin at import time; the node environment
// has no location.
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = new URL(
    "http://localhost/",
  );
});

// The channel log is what says whether a thread's root is held and
// muted; the test says what it holds.
const { readRow } = vi.hoisted(() => ({ readRow: vi.fn() }));
vi.mock("./channelLog", () => ({ readRow }));

const channel = (id: string, alertCount = 0, muted = false): Channel =>
  ({
    id,
    alertCount,
    muted,
    lastMessageId: "",
    lastReadMessageId: "",
  }) as Channel;

const space = (id: string, alertCount = 0, muted = false): Space =>
  ({ id, alertCount, muted }) as Space;

const root = (muted: boolean): Message =>
  ({ id: "root", thread: { muted } }) as Message;

function loaded() {
  const qc = new QueryClient();
  qc.setQueryData(["channels", "hq"], [channel("general", 2)]);
  qc.setQueryData(["spaces"], [space("hq", 2), space("club", 1)]);
  return qc;
}

const counts = (qc: QueryClient) => ({
  channel: qc.getQueryData<Channel[]>(["channels", "hq"])?.[0]?.alertCount,
  space: qc.getQueryData<Space[]>(["spaces"])?.[0]?.alertCount,
  other: qc.getQueryData<Space[]>(["spaces"])?.[1]?.alertCount,
});

beforeEach(() => readRow.mockReset());

describe("noteAlert", () => {
  it("adds one to the channel and its space", () => {
    const qc = loaded();
    noteAlert(qc, "hq", "general");
    expect(counts(qc)).toEqual({ channel: 3, space: 3, other: 1 });
  });

  it("adds nothing for a muted channel or space", () => {
    const qc = loaded();
    qc.setQueryData(["channels", "hq"], [channel("general", 2, true)]);
    noteAlert(qc, "hq", "general");
    qc.setQueryData(["channels", "hq"], [channel("general", 2)]);
    qc.setQueryData(["spaces"], [space("hq", 2, true), space("club", 1)]);
    noteAlert(qc, "hq", "general");
    expect(counts(qc)).toEqual({ channel: 2, space: 2, other: 1 });
  });

  it("asks for the spaces list when the channel list is cold", () => {
    const qc = new QueryClient();
    qc.setQueryData(["spaces"], [space("hq", 2)]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    noteAlert(qc, "hq", "general");
    expect(counts(qc).space).toBe(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["spaces"],
      exact: true,
    });
  });

  it("adds nothing for a direct message", () => {
    const qc = loaded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    noteAlert(qc, "", "dm1");
    expect(counts(qc)).toEqual({ channel: 2, space: 2, other: 1 });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("counts a reply in a thread whose held root is not muted", () => {
    const qc = loaded();
    readRow.mockReturnValue(root(false));
    noteAlert(qc, "hq", "general", "root");
    expect(counts(qc)).toEqual({ channel: 3, space: 3, other: 1 });
  });

  it("adds nothing for a reply in a muted thread", () => {
    const qc = loaded();
    readRow.mockReturnValue(root(true));
    noteAlert(qc, "hq", "general", "root");
    expect(counts(qc)).toEqual({ channel: 2, space: 2, other: 1 });
  });

  it("asks for both lists when the thread's root is not held", () => {
    const qc = loaded();
    readRow.mockReturnValue(undefined);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    noteAlert(qc, "hq", "general", "root");
    expect(counts(qc)).toEqual({ channel: 2, space: 2, other: 1 });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["channels", "hq"],
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["spaces"],
      exact: true,
    });
  });
});

describe("refetchAlertsIfAny", () => {
  it("asks for both lists only while a count is held", () => {
    const qc = loaded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    refetchAlertsIfAny(qc, "hq", "general");
    expect(invalidate).toHaveBeenCalledTimes(2);
    qc.setQueryData(["channels", "hq"], [channel("general", 0)]);
    qc.setQueryData(["spaces"], [space("hq", 0)]);
    invalidate.mockClear();
    refetchAlertsIfAny(qc, "hq", "general");
    refetchAlertsIfAny(qc, "hq");
    expect(invalidate).not.toHaveBeenCalled();
  });
});

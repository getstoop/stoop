import { Code, ConnectError } from "@connectrpc/connect";
import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActivity } from "../api/activity";
import { sessionToken } from "../api/servers";
import { waitingOn } from "./useWaiting";

vi.mock("../api/activity", () => ({ loadActivity: vi.fn() }));
vi.mock("../api/servers", () => ({ sessionToken: vi.fn() }));

const SERVER = { id: "aaaaaa", origin: "https://stoop.example", name: "Stoop" };
const READ_AT = { seconds: 1n, nanos: 0 };

const token = vi.mocked(sessionToken);
const activity = vi.mocked(loadActivity);

// A feed holding these items, each a mention in a space unless it says.
function feed(...items: object[]) {
  activity.mockResolvedValue({
    items: items.map((over) => ({ kind: ActivityKind.MENTION, spaceId: "s1", channelId: "c1", ...over })),
    unreadCount: items.length,
  } as never);
}

const direct = { kind: ActivityKind.DM, spaceId: "", channelId: "dm1" };

describe("waitingOn", () => {
  beforeEach(() => {
    token.mockReset();
    token.mockResolvedValue("session");
    activity.mockReset();
  });

  it("counts a server with only direct messages", async () => {
    feed(direct, { ...direct, channelId: "dm2" }, { ...direct, channelId: "dm3" });
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 3 });
    expect(activity).toHaveBeenCalledWith(SERVER.origin, "session");
  });

  it("adds direct messages to what is waiting in spaces", async () => {
    feed(direct, {}, { spaceId: "s2", kind: ActivityKind.REPLY });
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 3 });
  });

  it("leaves out what the server stamped muted, a direct message and a muted space's items alike", async () => {
    feed({ ...direct, muted: true }, { muted: true }, { spaceId: "s2", muted: true }, {});
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 1 });
  });

  it("leaves out what is read and thread replies, as the Activity tab does", async () => {
    feed({ ...direct, readAt: READ_AT }, { readAt: READ_AT }, { kind: ActivityKind.THREAD_REPLY }, direct);
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 1 });
  });

  it("is zero with nothing waiting", async () => {
    feed();
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 0 });
  });

  it("has ended with no session kept, without asking the server", async () => {
    token.mockResolvedValue(null);
    expect(await waitingOn(SERVER)).toEqual({ state: "ended" });
    expect(activity).not.toHaveBeenCalled();
  });

  it("has ended when the server says it is over", async () => {
    activity.mockRejectedValue(new ConnectError("no", Code.Unauthenticated));
    expect(await waitingOn(SERVER)).toEqual({ state: "ended" });
  });

  it("has failed when the server can't be reached", async () => {
    activity.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    expect(await waitingOn(SERVER)).toEqual({ state: "failed" });
  });
});

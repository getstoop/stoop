import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { ChannelReadSchema, PresenceChangedSchema, ServerEventSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAlertLists } from "../api/alerts";
import { sessionToken } from "../api/servers";
import { alertsLoader, RELOAD_DELAY_MS } from "./loader";
import { NO_BADGES } from "./store";

// The lists are stood in for; which events ask again is the real rule.
vi.mock("../api/alerts", async (original) => ({
  ...(await original<typeof import("../api/alerts")>()),
  loadAlertLists: vi.fn(),
}));
vi.mock("../api/servers", () => ({ sessionToken: vi.fn() }));

const SERVER = { id: "aaaaaa", origin: "https://stoop.example" };

const token = vi.mocked(sessionToken);
const lists = vi.mocked(loadAlertLists);

// A server's answer whose total is `count`, all of it in a space.
const answer = (count: number) => ({ spaces: [{ muted: false, alertCount: count }], dms: [] }) as never;

const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
  create(ServerEventSchema, { payload });
const message = event({ case: "messageCreated", value: create(MessageSchema, { spaceId: "s1" }) });
const read = event({ case: "channelRead", value: create(ChannelReadSchema, { spaceId: "s1" }) });
const revoked = event({ case: "credentialRevoked", value: {} });

// An answer held back until the test lets it go.
function held() {
  let settle!: { resolve: (lists: never) => void; reject: (err: unknown) => void };
  const promise = new Promise<never>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

describe("alertsLoader", () => {
  let totals: number[];
  const start = () => alertsLoader(SERVER, (badges) => totals.push(badges.total));

  beforeEach(() => {
    vi.useFakeTimers();
    totals = [];
    token.mockReset();
    token.mockResolvedValue("session");
    lists.mockReset();
    lists.mockResolvedValue(answer(0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands on the server's total when asked", async () => {
    lists.mockResolvedValue(answer(3));
    await start().refresh();
    expect(totals).toEqual([3]);
    expect(lists).toHaveBeenCalledWith(SERVER.origin, "session");
  });

  it("hands on each tab's badge beside the total", async () => {
    lists.mockResolvedValue({
      spaces: [{ muted: false, alertCount: 3 }],
      dms: [{ closed: false, channel: { muted: false, unreadCount: 5 } }],
    } as never);
    const said: unknown[] = [];
    await alertsLoader(SERVER, (badges) => said.push(badges)).refresh();
    expect(said).toEqual([{ activity: 3, messages: 5, total: 4 }]);
  });

  it("clears both tabs' badges with the total when the session ends", async () => {
    lists.mockResolvedValue({
      spaces: [{ muted: false, alertCount: 3 }],
      dms: [{ closed: false, channel: { muted: false, unreadCount: 5 } }],
    } as never);
    const said: unknown[] = [];
    const loader = alertsLoader(SERVER, (badges) => said.push(badges));
    await loader.refresh();
    loader.event(revoked);
    expect(said).toEqual([{ activity: 3, messages: 5, total: 4 }, NO_BADGES]);
  });

  it("asks once, after a moment's quiet, for a burst of events", async () => {
    lists.mockResolvedValue(answer(2));
    const loader = start();
    loader.event(message);
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS - 1);
    loader.event(read);
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS - 1);
    expect(lists).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lists).toHaveBeenCalledTimes(1);
    expect(totals).toEqual([2]);
  });

  it("asks once, after the same quiet, on Ready", async () => {
    lists.mockResolvedValue(answer(6));
    start().event(event({ case: "ready", value: {} }));
    expect(lists).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS);
    expect(lists).toHaveBeenCalledTimes(1);
    expect(totals).toEqual([6]);
  });

  it("leaves an event that changes no count", async () => {
    start().event(event({ case: "presenceChanged", value: create(PresenceChangedSchema, {}) }));
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS);
    expect(lists).not.toHaveBeenCalled();
  });

  it("drops an older load that finishes after a newer one", async () => {
    const older = held();
    lists.mockReturnValueOnce(older.promise).mockResolvedValueOnce(answer(1));
    const loader = start();
    const first = loader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    await loader.refresh();
    older.resolve(answer(9));
    await first;
    expect(totals).toEqual([1]);
  });

  it("keeps the last total when a load fails", async () => {
    lists.mockResolvedValueOnce(answer(4)).mockRejectedValueOnce(new ConnectError("down", Code.Unavailable));
    const loader = start();
    await loader.refresh();
    await loader.refresh();
    expect(totals).toEqual([4]);
    lists.mockResolvedValue(answer(5));
    await loader.refresh();
    expect(totals).toEqual([4, 5]);
  });

  it.each([
    ["no session is kept", () => token.mockResolvedValue(null)],
    ["the server refuses the session", () => lists.mockRejectedValue(new ConnectError("no", Code.Unauthenticated))],
  ])("has none and asks no more once %s", async (_name, arrange) => {
    lists.mockResolvedValueOnce(answer(4));
    const loader = start();
    await loader.refresh();
    arrange();
    await loader.refresh();
    expect(totals).toEqual([4, 0]);
    token.mockClear();
    lists.mockClear();
    await loader.refresh();
    loader.event(message);
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS);
    expect(token).not.toHaveBeenCalled();
    expect(lists).not.toHaveBeenCalled();
    expect(totals).toEqual([4, 0]);
  });

  it("keeps the last total while the keychain won't be read, and asks again once it will", async () => {
    lists.mockResolvedValueOnce(answer(4));
    const loader = start();
    await loader.refresh();
    token.mockRejectedValueOnce(new Error("keychain"));
    await loader.refresh();
    expect(totals).toEqual([4]);
    lists.mockResolvedValue(answer(5));
    await loader.refresh();
    expect(totals).toEqual([4, 5]);
  });

  it("has none on CredentialRevoked, whatever was waiting or still loading", async () => {
    const loading = held();
    lists.mockResolvedValueOnce(answer(4)).mockReturnValueOnce(loading.promise);
    const loader = start();
    await loader.refresh();
    loader.event(message);
    const late = loader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    loader.event(revoked);
    loading.resolve(answer(7));
    await late;
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS);
    expect(totals).toEqual([4, 0]);
    expect(lists).toHaveBeenCalledTimes(2);
  });

  it("says nothing after it is stopped", async () => {
    const loading = held();
    lists.mockReturnValueOnce(loading.promise);
    const loader = start();
    const late = loader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    loader.event(message);
    loader.stop();
    loading.reject(new ConnectError("no", Code.Unauthenticated));
    await late;
    loader.event(revoked);
    await loader.refresh();
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS);
    expect(totals).toEqual([]);
    expect(lists).toHaveBeenCalledTimes(1);
  });
});

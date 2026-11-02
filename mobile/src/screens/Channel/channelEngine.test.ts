import { id, message, page, rows } from "@stoop/core/channelLog/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAround, loadChannel, loadNewer, loadOlder, loadReplies, loadRoot } from "../../api/messages";
import { channelEngine, holdEngine } from "./channelEngine";

// None of these needs the app's native code or its packages, which the Web
// job that runs this file doesn't install.
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("@connectrpc/connect", () => ({
  Code: { Unauthenticated: 16, NotFound: 5, PermissionDenied: 7, InvalidArgument: 3 },
  ConnectError: class extends Error {},
}));
vi.mock("../../api/files", () => ({ uploadAttachment: vi.fn() }));
vi.mock("../../api/servers", () => ({ sessionToken: vi.fn(async () => "t1") }));
vi.mock("../../api/messages", () => ({
  ChannelGone: class extends Error {},
  PAGE: 50,
  loadAround: vi.fn(),
  loadChannel: vi.fn(),
  loadNewer: vi.fn(),
  loadOlder: vi.fn(),
  loadPage: vi.fn(),
  loadReplies: vi.fn(),
  loadRoot: vi.fn(),
}));

const SERVER = { id: "server", origin: "https://stoop.test", name: "Stoop" };
const ROOT = "root";
const COOLDOWN_MS = 10_000;

const flush = () => vi.advanceTimersByTimeAsync(0);
const asked = (load: unknown) => vi.mocked(load as () => unknown).mock.calls.length;

// A held engine on an open channel, older pages to go, with every page after
// the first failing.
async function openEngine(rootId?: string) {
  vi.mocked(loadChannel).mockResolvedValue({
    header: { channel: { id: "c1", lastReadMessageId: "" }, myUserId: "me", members: [], groups: [] },
    page: page(rows(10, 20), { hasOlder: true, channelSeq: 20 }),
    found: true,
  } as never);
  vi.mocked(loadOlder).mockRejectedValue(new Error("offline"));
  vi.mocked(loadNewer).mockRejectedValue(new Error("offline"));
  const held = holdEngine(
    channelEngine(SERVER, "s1", "c1", () => () => {}),
    rootId,
  );
  releases.push(held.release);
  await flush();
  return held.engine;
}

const releases: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});

describe("a failed older page", () => {
  it("sends nothing however often the list asks until the cooldown passes", async () => {
    const engine = await openEngine();
    await engine.older();
    expect(asked(loadOlder)).toBe(1);
    expect(engine.current().olderFailedAt).toBe(Date.now());
    expect(engine.current().loadingOlder).toBe(false);

    // The list asks again as the spinner goes and the retry row comes.
    await engine.older();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS - 1);
    await engine.older();
    expect(asked(loadOlder)).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
    // That failure starts another wait.
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
  });

  it("sends nothing by itself when the cooldown passes", async () => {
    const engine = await openEngine();
    await engine.older();
    await vi.advanceTimersByTimeAsync(COOLDOWN_MS * 5);
    expect(asked(loadOlder)).toBe(1);
    expect(engine.current().olderFailedAt).not.toBeNull();
  });

  it("is asked for again at once by the reader's tap, which clears the failure on success", async () => {
    const engine = await openEngine();
    await engine.older();
    vi.mocked(loadOlder).mockResolvedValue(page(rows(0, 10), { hasOlder: false, channelSeq: 20 }) as never);
    const retry = engine.retryOlder();
    expect(engine.current().olderFailedAt).toBeNull();
    expect(engine.current().loadingOlder).toBe(true);
    await retry;
    expect(asked(loadOlder)).toBe(2);
    expect(engine.current().olderFailedAt).toBeNull();
    expect(engine.current().log.channel.hasOlder).toBe(false);
  });

  it("holds nothing back after a success", async () => {
    const engine = await openEngine();
    vi.mocked(loadOlder).mockResolvedValue(page(rows(5, 10), { hasOlder: true, channelSeq: 20 }) as never);
    await engine.older();
    await engine.older();
    expect(asked(loadOlder)).toBe(2);
  });
});

describe("a failed newer page", () => {
  it("waits on its own, without holding back the older edge", async () => {
    const engine = await openEngine();
    vi.mocked(loadAround).mockResolvedValue(page(rows(30, 40), { hasOlder: true, hasNewer: true }) as never);
    await engine.jumpTo(id(35));
    engine.landed();
    await engine.newer();
    expect(asked(loadNewer)).toBe(1);
    expect(engine.current().newerFailedAt).toBe(Date.now());

    await engine.newer();
    expect(asked(loadNewer)).toBe(1);
    await engine.older();
    expect(asked(loadOlder)).toBe(1);

    await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
    await engine.newer();
    expect(asked(loadNewer)).toBe(2);

    await engine.retryNewer();
    expect(asked(loadNewer)).toBe(3);
  });
});

describe("a failed page of replies", () => {
  it("waits the same way, and a tap goes at once", async () => {
    vi.mocked(loadReplies).mockImplementation((async (...args: unknown[]) => {
      if (args[4]) throw new Error("offline");
      return page([message("r5", { seq: 25n, threadRootId: ROOT, inChannel: false })], {
        hasOlder: true,
        channelSeq: 25,
      });
    }) as never);
    vi.mocked(loadRoot).mockResolvedValue(message(ROOT, { seq: 5n }) as never);
    const engine = await openEngine(ROOT);
    const beforeId = () => vi.mocked(loadReplies).mock.calls.filter((call) => call[4]).length;

    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(1);
    expect(engine.current().threads[ROOT].olderFailedAt).toBe(Date.now());
    expect(engine.current().threads[ROOT].loadingOlder).toBe(false);

    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(1);

    await engine.retryOlderReplies(ROOT);
    expect(beforeId()).toBe(2);

    await vi.advanceTimersByTimeAsync(COOLDOWN_MS);
    await engine.olderReplies(ROOT);
    expect(beforeId()).toBe(3);
  });
});

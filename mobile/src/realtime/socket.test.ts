import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static opened: FakeSocket[] = [];
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: (event: { code: number }) => void;
  bearer: string;
  constructor(_url: string, _protocols: null, options: { headers: Record<string, string> }) {
    this.bearer = options.headers.Authorization;
    FakeSocket.opened.push(this);
  }
  close() {}
}
vi.stubGlobal("WebSocket", FakeSocket);
const { openRealtime } = await import("./socket");

// Lets the token's read finish and any backoff run out.
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("openRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.opened = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reopens after a drop, on what the keychain holds by then", async () => {
    const token = vi.fn().mockResolvedValueOnce("first").mockResolvedValue("second");
    const onClose = vi.fn();
    const socket = openRealtime("https://a.example", token, () => {}, onClose);
    await wait(0);
    FakeSocket.opened[0].onclose?.({ code: 1006 });
    expect(onClose).toHaveBeenCalledTimes(1);
    await wait(1000);
    expect(FakeSocket.opened.map((open) => open.bearer)).toEqual(["Bearer first", "Bearer second"]);
    socket.close();
  });

  // The session is over, and a new sign-in replaces this socket: nothing
  // here reads the keychain, so it can't pick up a token ahead of the list.
  it("stops once the server says the session has ended", async () => {
    const token = vi.fn().mockResolvedValue("first");
    const onClose = vi.fn();
    const socket = openRealtime("https://a.example", token, () => {}, onClose);
    await wait(0);
    FakeSocket.opened[0].onclose?.({ code: 4001 });
    expect(onClose).toHaveBeenCalledTimes(1);
    token.mockResolvedValue("second");
    await wait(60_000);
    expect(token).toHaveBeenCalledTimes(1);
    expect(FakeSocket.opened).toHaveLength(1);
    socket.close();
  });

  it("says nothing and tries nothing once closed", async () => {
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, onClose);
    await wait(0);
    socket.close();
    FakeSocket.opened[0].onmessage?.({ data: new ArrayBuffer(0) });
    FakeSocket.opened[0].onclose?.({ code: 1000 });
    await wait(60_000);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(FakeSocket.opened).toHaveLength(1);
  });

  it("dials nothing when closed while the token is still being read", async () => {
    const socket = openRealtime("https://a.example", () => Promise.resolve("first"), () => {}, () => {});
    socket.close();
    await wait(0);
    expect(FakeSocket.opened).toHaveLength(0);
  });
});

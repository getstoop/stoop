import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/servers", () => ({ sessionToken: vi.fn() }));

class FakeSocket {
  static opened: FakeSocket[] = [];
  // Every dial is refused a moment later, as a server that is down or a 401 is.
  static refusing = false;
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: (event: { code?: number }) => void;
  bearer: string;
  constructor(_url: string, _protocols: null, options: { headers: Record<string, string> }) {
    this.bearer = options.headers.Authorization;
    FakeSocket.opened.push(this);
    if (FakeSocket.refusing) setTimeout(() => this.onclose?.({}), 0);
  }
  closes = 0;
  close() {
    this.closes += 1;
  }
}
vi.stubGlobal("WebSocket", FakeSocket);
const { openRealtime } = await import("./socket");

// Lets the token's read finish and any backoff run out.
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

// The check is a real GetMe, through the real client: what is faked is what
// the server answers, so what counts as ended is decided where it will be.
const server = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", server);
const offline = () => Promise.reject(new TypeError("Network request failed"));
const refused = () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: "unauthenticated", message: "authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
const unavailable = () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: "unavailable", message: "can't check your sign-in" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
  );
// A proxy in front of a server that is down: not an answer from the server.
const gatewayError = (status: number) => () => Promise.resolve(new Response("<html>Bad gateway</html>", { status }));
const hangs = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
const proxy401 = (body: string, headers?: Record<string, string>) => () =>
  Promise.resolve(new Response(body, { status: 401, headers }));
const CHECK_PATH = "/stoop.auth.v1.AuthService/GetMe";
const heard = (onEvent: ReturnType<typeof vi.fn>) => onEvent.mock.calls.map(([event]) => event.payload.case);

describe("openRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.opened = [];
    FakeSocket.refusing = false;
    server.mockReset();
    server.mockImplementation(offline);
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
    const onEvent = vi.fn();
    const socket = openRealtime("https://a.example", token, onEvent, onClose);
    await wait(0);
    FakeSocket.opened[0].onclose?.({ code: 4001 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard(onEvent)).toEqual(["credentialRevoked"]);
    token.mockResolvedValue("second");
    await wait(60_000);
    expect(token).toHaveBeenCalledTimes(1);
    expect(FakeSocket.opened).toHaveLength(1);
    expect(server).not.toHaveBeenCalled();
    socket.close();
  });

  describe("a dial that never opened", () => {
    it("stops and says so once the server answers Unauthenticated", async () => {
      FakeSocket.refusing = true;
      server.mockImplementation(refused);
      const onEvent = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, () => {});
      await wait(60_000);
      expect(heard(onEvent)).toEqual(["credentialRevoked"]);
      expect(FakeSocket.opened).toHaveLength(1);
      expect(server).toHaveBeenCalledTimes(1);
      const [url, init] = server.mock.calls[0];
      expect(String(url)).toBe(`https://a.example${CHECK_PATH}`);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer first");
      socket.close();
    });

    it.each([
      ["a network failure", offline],
      ["Unavailable", unavailable],
      ["a 500", gatewayError(500)],
      ["a 502", gatewayError(502)],
      ["a 503", gatewayError(503)],
      ["a 504", gatewayError(504)],
      ["a timeout", hangs],
      ["an HTML 401", proxy401("<html>Sign in</html>", { "Content-Type": "text/html" })],
      ["a 401 with no content type", proxy401("")],
      ["a JSON 401 with an empty body", proxy401("", { "Content-Type": "application/json" })],
      ["a JSON 401 of another shape", proxy401('{"error":"nope"}', { "Content-Type": "application/json" })],
      ["a Connect 401 with no message", proxy401('{"code":"unauthenticated"}', { "Content-Type": "application/json" })],
    ])("keeps retrying on its usual backoff on %s", async (_answer, answer) => {
      FakeSocket.refusing = true;
      server.mockImplementation(answer);
      const onEvent = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, () => {});
      // At 0, 1, 3, 7, 15, 30, 45 and 60 s.
      await wait(61_000);
      expect(FakeSocket.opened).toHaveLength(8);
      expect(onEvent).not.toHaveBeenCalled();
      socket.close();
    });

    it("keeps retrying when the check says the session is fine", async () => {
      FakeSocket.refusing = true;
      server.mockImplementation(() =>
        Promise.resolve(new Response(new Uint8Array(), { status: 200, headers: { "Content-Type": "application/proto" } })),
      );
      const onEvent = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, () => {});
      await wait(61_000);
      expect(FakeSocket.opened).toHaveLength(8);
      expect(onEvent).not.toHaveBeenCalled();
      socket.close();
    });

    it("adds little to an hour's outage", async () => {
      FakeSocket.refusing = true;
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), () => {}, () => {});
      await wait(60 * 60_000);
      // About four dials a minute, a check at once and every five minutes.
      expect(FakeSocket.opened.length).toBeGreaterThan(235);
      expect(server).toHaveBeenCalledTimes(12);
      socket.close();
    });

    it("asks nothing when a restart is over before the wait after a drop", async () => {
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), () => {}, () => {});
      await wait(0);
      FakeSocket.opened[0].onopen?.();
      FakeSocket.opened[0].onclose?.({ code: 1006 });
      FakeSocket.refusing = true;
      await wait(25_000);
      expect(FakeSocket.opened.length).toBeGreaterThan(3);
      expect(server).not.toHaveBeenCalled();
      socket.close();
    });

    it("finds a session that ended during an outage", async () => {
      FakeSocket.refusing = true;
      const onEvent = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, () => {});
      await wait(60_000);
      expect(onEvent).not.toHaveBeenCalled();
      server.mockImplementation(refused);
      await wait(5 * 60_000);
      expect(heard(onEvent)).toEqual(["credentialRevoked"]);
      const dials = FakeSocket.opened.length;
      await wait(60_000);
      expect(FakeSocket.opened).toHaveLength(dials);
      socket.close();
    });

    it("ignores a check that answers after a socket has opened, which stays open", async () => {
      let answer: (response: Response) => void = () => {};
      server.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const onEvent = vi.fn();
      const onClose = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, onClose);
      await wait(0);
      FakeSocket.opened[0].onclose?.({});
      await wait(1000);
      FakeSocket.opened[1].onopen?.();
      answer((await refused()) as Response);
      await wait(0);
      expect(onEvent).not.toHaveBeenCalled();
      expect(FakeSocket.opened[1].closes).toBe(0);
      expect(onClose).toHaveBeenCalledTimes(1);
      socket.close();
    });

    it("says nothing when closed while the check is out", async () => {
      let answer: (response: Response) => void = () => {};
      server.mockImplementation(() =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const onEvent = vi.fn();
      const socket = openRealtime("https://a.example", () => Promise.resolve("first"), onEvent, () => {});
      await wait(0);
      FakeSocket.opened[0].onclose?.({});
      socket.close();
      answer((await refused()) as Response);
      await wait(60_000);
      expect(onEvent).not.toHaveBeenCalled();
      expect(FakeSocket.opened).toHaveLength(1);
    });
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

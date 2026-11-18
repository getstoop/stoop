import { Code, ConnectError } from "@connectrpc/connect";
import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import type { PushRecord } from "./record";
import { RelayError } from "./relay";
import { DAY_MS } from "./renewal";
import { type PushServer, pushSubscriber, type SubscriberDeps } from "./subscriber";

const START = Date.UTC(2026, 10, 17, 12);
const ALL = [ActivityKind.MENTION, ActivityKind.REPLY, ActivityKind.DM, ActivityKind.THREAD_REPLY];

// A phone, its servers and the relay in memory. `calls` is every call
// that went out, in order; `fail` makes the named call reject once with
// the given error each time it is set.
function world(change: Partial<SubscriberDeps> = {}) {
  let now = START;
  const servers: PushServer[] = [
    { id: "aaa111", origin: "https://one.example", session: 1 },
    { id: "bbb222", origin: "https://two.example", session: 1 },
  ];
  const tokens = new Map([
    ["aaa111", "token-one"],
    ["bbb222", "token-two"],
  ]);
  const records = new Map<string, PushRecord>();
  const keys = new Set<string>();
  const calls: string[] = [];
  const lines: string[] = [];
  const timers: { at: number; done: () => void; off: boolean }[] = [];
  const fail = new Map<string, unknown>();
  const state = {
    deviceToken: "d1",
    serverKey: "key-1",
    kinds: ALL as ActivityKind[] | null,
    allowed: true,
    issued: 0,
  };
  const maybeFail = (name: string) => {
    const error = fail.get(name);
    if (error !== undefined) {
      fail.delete(name);
      throw error;
    }
  };

  const deps: SubscriberDeps = {
    relayUrl: "https://relay.example",
    supported: true,
    servers: () => servers,
    sessionToken: async (id) => tokens.get(id) ?? null,
    allowed: async () => state.allowed,
    deviceToken: async () => {
      calls.push("deviceToken");
      maybeFail("deviceToken");
      return state.deviceToken;
    },
    target: async () => ({ appId: "org.getstoop.dev", environment: "sandbox" }),
    ensureKeys: async (id) => {
      keys.add(id);
      return { p256dh: `p256dh-${id}`, auth: `auth-${id}` };
    },
    removeKeys: async (id) => {
      calls.push(`removeKeys ${id}`);
      keys.delete(id);
    },
    getConfig: async (origin) => {
      calls.push(`getConfig ${origin}`);
      maybeFail(`getConfig ${origin}`);
      return { enabled: true, serverKey: state.serverKey };
    },
    register: async (origin, _token, registration) => {
      calls.push(`register ${origin} ${registration.localServerId} ${registration.endpoint}`);
      maybeFail(`register ${origin}`);
    },
    update: async (origin, _token, kinds) => {
      calls.push(`update ${origin} ${kinds.join(",")}`);
      maybeFail(`update ${origin}`);
    },
    remove: async (origin) => {
      calls.push(`remove ${origin}`);
      maybeFail(`remove ${origin}`);
    },
    subscribe: async (_relay, request) => {
      calls.push(`relay ${request.environment} ${request.token} ${request.vapidKey}`);
      maybeFail("relay");
      state.issued++;
      return { endpoint: `https://relay.example/push/${state.issued}`, expiresAt: now + 30 * DAY_MS };
    },
    records: {
      get: async (id) => records.get(id) ?? null,
      set: async (id, record) => {
        records.set(id, record);
      },
      remove: async (id) => {
        calls.push(`removeRecord ${id}`);
        records.delete(id);
      },
    },
    kinds: () => state.kinds,
    now: () => now,
    wait: (ms, done) => {
      const timer = { at: now + ms, done, off: false };
      timers.push(timer);
      return () => {
        timer.off = true;
      };
    },
    log: (line) => lines.push(line),
    ...change,
  };
  const subscriber = pushSubscriber(deps);

  return {
    subscriber,
    // The calls that leave the phone, without the asks for the device token.
    out: () => calls.filter((call) => call !== "deviceToken"),
    servers,
    tokens,
    records,
    keys,
    calls,
    lines,
    fail,
    state,
    timers: () => timers.filter((timer) => !timer.off),
    advance: (ms: number) => {
      now += ms;
      for (const timer of timers) {
        if (!timer.off && timer.at <= now) {
          timer.off = true;
          timer.done();
        }
      }
    },
    // Runs a check and waits for it.
    async check() {
      subscriber.check();
      await subscriber.idle();
    },
  };
}

describe("the check", () => {
  it("subscribes each server in turn, keyed by its local ID", async () => {
    const phone = world();
    await phone.check();
    expect(phone.out()).toEqual([
      "getConfig https://one.example",
      "removeKeys aaa111",
      "relay sandbox d1 key-1",
      "register https://one.example aaa111 https://relay.example/push/1",
      "getConfig https://two.example",
      "removeKeys bbb222",
      "relay sandbox d1 key-1",
      "register https://two.example bbb222 https://relay.example/push/2",
    ]);
    expect([...phone.keys]).toEqual(["aaa111", "bbb222"]);
    expect(phone.records.get("aaa111")).toEqual({
      session: 1,
      localServerId: "aaa111",
      endpoint: "https://relay.example/push/1",
      issuedAt: START,
      expiresAt: START + 30 * DAY_MS,
      vapidKey: "key-1",
      deviceToken: "d1",
      kinds: ALL,
      checkedAt: START,
    });
    expect(phone.lines).toEqual([
      "PUSH_SUBSCRIBE aaa111 one.example subscribed",
      "PUSH_SUBSCRIBE bbb222 two.example subscribed",
    ]);
  });

  it("is not repeated within a day of completing, and updates after it", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    phone.advance(DAY_MS - 1);
    await phone.check();
    expect(phone.out()).toEqual([]);
    phone.advance(1);
    await phone.check();
    expect(phone.out()).toEqual([
      "getConfig https://one.example",
      `update https://one.example ${ALL.join(",")}`,
      "getConfig https://two.example",
      `update https://two.example ${ALL.join(",")}`,
    ]);
    expect(phone.records.get("aaa111")?.checkedAt).toBe(START + DAY_MS);
    expect(phone.records.get("aaa111")?.endpoint).toBe("https://relay.example/push/1");
  });

  it("renews at 7 days old with the same keys", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    phone.advance(7 * DAY_MS);
    await phone.check();
    expect(phone.out().filter((call) => call.startsWith("relay"))).toHaveLength(2);
    expect(phone.records.get("aaa111")?.issuedAt).toBe(START + 7 * DAY_MS);
    expect(phone.lines.at(-2)).toBe("PUSH_SUBSCRIBE aaa111 one.example renewed: 7 days old");
  });

  it("renews when the server's key changed, at the next daily check", async () => {
    const phone = world();
    await phone.check();
    phone.state.serverKey = "key-2";
    phone.advance(DAY_MS);
    await phone.check();
    expect(phone.records.get("aaa111")?.vapidKey).toBe("key-2");
    expect(phone.lines).toContain("PUSH_SUBSCRIBE aaa111 one.example renewed: server key changed");
  });

  it("renews at once when the server answers NotFound", async () => {
    const phone = world();
    await phone.check();
    phone.advance(DAY_MS);
    phone.fail.set("update https://one.example", new ConnectError("no row", Code.NotFound));
    await phone.check();
    expect(phone.records.get("aaa111")?.endpoint).toBe("https://relay.example/push/3");
    expect(phone.lines).toContain("PUSH_SUBSCRIBE aaa111 one.example renewed: the server had no subscription");
  });

  it("renews every server when the device token changes, whatever the day", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    phone.state.deviceToken = "d2";
    phone.subscriber.tokenSeen("d2");
    await phone.subscriber.idle();
    expect(phone.out().filter((call) => call.startsWith("relay"))).toEqual(["relay sandbox d2 key-1", "relay sandbox d2 key-1"]);
    expect(phone.records.get("bbb222")?.deviceToken).toBe("d2");
    // The same token again is nothing new.
    phone.calls.length = 0;
    phone.subscriber.tokenSeen("d2");
    await phone.subscriber.idle();
    expect(phone.out()).toEqual([]);
  });

  it("tells the server new kinds at once", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    phone.state.kinds = [ActivityKind.DM];
    phone.subscriber.kindsChanged();
    await phone.subscriber.idle();
    expect(phone.out()).toEqual([
      "getConfig https://one.example",
      `update https://one.example ${ActivityKind.DM}`,
      "getConfig https://two.example",
      `update https://two.example ${ActivityKind.DM}`,
    ]);
    expect(phone.records.get("aaa111")?.kinds).toEqual([ActivityKind.DM]);
  });

  it("registers a new sign-in to the same server as a new subscription, with new keys", async () => {
    const phone = world();
    await phone.check();
    phone.servers[0] = { ...phone.servers[0], session: 2 };
    phone.calls.length = 0;
    await phone.check();
    expect(phone.calls.slice(0, 3)).toEqual(["deviceToken", "getConfig https://one.example", "removeKeys aaa111"]);
    expect(phone.records.get("aaa111")?.session).toBe(2);
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example subscribed");
  });

  it("skips quietly while notifications are not allowed, and does not use up the day", async () => {
    const phone = world();
    phone.state.allowed = false;
    await phone.check();
    expect(phone.out()).toEqual([]);
    expect(phone.lines[0]).toBe("PUSH_SUBSCRIBE aaa111 one.example skipped: notifications not allowed");
    phone.state.allowed = true;
    await phone.check();
    expect(phone.records.size).toBe(2);
  });

  it("skips a server without push for the day", async () => {
    const phone = world();
    phone.fail.set("getConfig https://one.example", new ConnectError("no such procedure", Code.Unimplemented));
    await phone.check();
    expect(phone.records.has("aaa111")).toBe(false);
    expect(phone.records.has("bbb222")).toBe(true);
    expect(phone.lines[0]).toBe("PUSH_SUBSCRIBE aaa111 one.example skipped: the server has no push");
    phone.calls.length = 0;
    await phone.check();
    expect(phone.out()).toEqual([]);
    expect(phone.timers()).toEqual([]);
  });

  it("skips a build signed without push, before asking for a device token it can't have", async () => {
    const phone = world({ target: async () => ({ appId: "org.getstoop.dev", environment: null }) });
    phone.fail.set("deviceToken", new Error("no aps-environment"));
    await phone.check();
    expect(phone.calls).toEqual([]);
    expect(phone.lines[0]).toBe("PUSH_SUBSCRIBE aaa111 one.example skipped: this build is not signed for push");
    expect(phone.timers()).toEqual([]);
  });

  it("skips for the day a server whose push went off, though it has a record", async () => {
    const phone = world();
    await phone.check();
    phone.advance(DAY_MS);
    phone.fail.set("getConfig https://one.example", new ConnectError("no such procedure", Code.Unimplemented));
    await phone.check();
    phone.calls.length = 0;
    phone.advance(60_000);
    await phone.check();
    expect(phone.calls).toEqual([]);
  });

  it("uses a token heard while the ask was under way", async () => {
    let answer: (token: string) => void = () => {};
    const slow = world({
      deviceToken: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });
    slow.servers.pop();
    slow.subscriber.check();
    await new Promise((resolve) => setTimeout(resolve, 0));
    slow.subscriber.tokenSeen("d2");
    answer("d1");
    await slow.subscriber.idle();
    expect(slow.records.get("aaa111")?.deviceToken).toBe("d2");
  });

  it("waits for the saved notification settings before telling a server any kinds", async () => {
    const phone = world();
    phone.state.kinds = null;
    await phone.check();
    expect(phone.calls).toEqual([]);
    expect(phone.lines[0]).toBe("PUSH_SUBSCRIBE aaa111 one.example skipped: notification settings not read yet");
    phone.state.kinds = [ActivityKind.DM];
    phone.subscriber.kindsChanged();
    await phone.subscriber.idle();
    expect(phone.records.get("aaa111")?.kinds).toEqual([ActivityKind.DM]);
  });

  it("asks for the device token once a pass, and not at all within the day", async () => {
    const phone = world();
    await phone.check();
    expect(phone.calls.filter((call) => call === "deviceToken")).toHaveLength(1);
    phone.calls.length = 0;
    await phone.check();
    expect(phone.calls).toEqual([]);
  });
});

describe("failures", () => {
  it("keep the old record and retry with backoff, honouring Retry-After", async () => {
    const phone = world();
    await phone.check();
    const before = phone.records.get("aaa111");
    phone.advance(7 * DAY_MS);
    phone.fail.set("relay", new RelayError(429, "relay answered 429", 300_000));
    await phone.check();
    expect(phone.records.get("aaa111")).toEqual(before);
    expect(phone.lines).toContain("PUSH_SUBSCRIBE aaa111 one.example failed: relay: relay answered 429 (retry in 300 s)");
    // The other server is not held up.
    expect(phone.records.get("bbb222")?.issuedAt).toBe(START + 7 * DAY_MS);

    // Not before Retry-After, even when the app comes to the front.
    phone.calls.length = 0;
    phone.advance(60_000);
    await phone.check();
    expect(phone.out().filter((call) => call.includes("one.example"))).toEqual([]);

    phone.advance(240_000);
    await phone.subscriber.idle();
    expect(phone.records.get("aaa111")?.issuedAt).toBe(START + 7 * DAY_MS + 300_000);
    expect(phone.timers()).toEqual([]);
  });

  it("double the wait each time and do not use up the day", async () => {
    const phone = world();
    phone.servers.pop();
    phone.fail.set("getConfig https://one.example", new Error("offline"));
    await phone.check();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example failed: push config: offline (retry in 60 s)");
    phone.fail.set("getConfig https://one.example", new Error("offline"));
    phone.advance(60_000);
    await phone.subscriber.idle();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example failed: push config: offline (retry in 120 s)");
    phone.advance(120_000);
    await phone.subscriber.idle();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example subscribed");
  });

  it("renew again after a NotFound whose renewal failed, though the record was checked today", async () => {
    const phone = world();
    phone.servers.pop();
    await phone.check();
    phone.advance(DAY_MS);
    phone.fail.set("update https://one.example", new ConnectError("no row", Code.NotFound));
    phone.fail.set("register https://one.example", new Error("offline"));
    await phone.check();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example failed: register: offline (retry in 60 s)");
    // The server still has no row, and the retry is not held by the day.
    phone.fail.set("update https://one.example", new ConnectError("no row", Code.NotFound));
    phone.advance(60_000);
    await phone.subscriber.idle();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example renewed: the server had no subscription");
  });

  it("belong to the session: a new sign-in does not wait out the old one's", async () => {
    const phone = world();
    phone.servers.pop();
    phone.fail.set("relay", new RelayError(429, "relay answered 429", 3_600_000));
    await phone.check();
    phone.servers[0] = { ...phone.servers[0], session: 2 };
    await phone.check();
    expect(phone.records.get("aaa111")?.session).toBe(2);
    expect(phone.timers()).toEqual([]);
  });

  it("still tell the server new kinds while a renewal waits out its backoff", async () => {
    const phone = world();
    phone.servers.pop();
    await phone.check();
    phone.advance(7 * DAY_MS);
    phone.fail.set("relay", new RelayError(429, "relay answered 429", 3_600_000));
    await phone.check();
    phone.calls.length = 0;
    phone.state.kinds = [];
    phone.subscriber.kindsChanged();
    await phone.subscriber.idle();
    expect(phone.out()).toEqual(["update https://one.example "]);
    expect(phone.records.get("aaa111")?.kinds).toEqual([]);
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example updated kinds (a retry still waits)");
    expect(phone.timers()).toHaveLength(1);
  });

  it("stop at a session the server says is over", async () => {
    const phone = world();
    phone.servers.pop();
    phone.fail.set("getConfig https://one.example", new ConnectError("not logged in", Code.Unauthenticated));
    await phone.check();
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example skipped: signed out");
    expect(phone.timers()).toEqual([]);
  });
});

describe("leaving a server", () => {
  it("deletes on the server, then forgets the keys and the record", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    await phone.subscriber.leave(phone.servers[0], "token-one");
    await phone.subscriber.idle();
    expect(phone.out()).toEqual(["remove https://one.example", "removeKeys aaa111", "removeRecord aaa111"]);
    expect(phone.records.has("aaa111")).toBe(false);
    expect(phone.keys.has("aaa111")).toBe(false);
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example removed: told the server");
  });

  it("forgets them even when the server can't be told", async () => {
    const phone = world();
    await phone.check();
    phone.fail.set("remove https://one.example", new Error("offline"));
    await phone.subscriber.leave(phone.servers[0], "token-one");
    await phone.subscriber.idle();
    expect(phone.records.has("aaa111")).toBe(false);
    expect(phone.keys.has("aaa111")).toBe(false);
    expect(phone.lines.at(-1)).toBe("PUSH_SUBSCRIBE aaa111 one.example removed: the server was not told (offline)");
  });

  it("forgets them with no session to ask with", async () => {
    const phone = world();
    await phone.check();
    phone.calls.length = 0;
    await phone.subscriber.leave(phone.servers[0], null);
    await phone.subscriber.idle();
    expect(phone.out()).toEqual(["removeKeys aaa111", "removeRecord aaa111"]);
  });

  it("waits for a check in progress, and drops one still to come", async () => {
    const phone = world();
    phone.subscriber.check();
    const leaving = phone.servers[1];
    void phone.subscriber.leave(leaving, "token-two");
    phone.servers.pop();
    await phone.subscriber.idle();
    expect(phone.records.has("aaa111")).toBe(true);
    expect(phone.records.has("bbb222")).toBe(false);
    expect(phone.out()).not.toContain("getConfig https://two.example");
    expect(phone.timers()).toEqual([]);
  });

  it("asks the server again after a check that was running as it left", async () => {
    let answer: () => void = () => {};
    const phone = world({
      getConfig: () =>
        new Promise((resolve) => {
          answer = () => resolve({ enabled: true, serverKey: "key-1" });
        }),
    });
    phone.servers.pop();
    phone.subscriber.check();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const leaving = phone.subscriber.leave(phone.servers[0], "token-one");
    answer();
    await leaving;
    await phone.subscriber.idle();
    expect(phone.out().filter((call) => call.startsWith("remove "))).toEqual([
      "remove https://one.example",
      "remove https://one.example",
    ]);
    expect(phone.out().at(-3)).toBe("remove https://one.example");
    expect(phone.records.has("aaa111")).toBe(false);
  });

  it("calls off a retry that was waiting", async () => {
    const phone = world();
    phone.fail.set("relay", new RelayError(503, "relay answered 503"));
    await phone.check();
    expect(phone.timers()).toHaveLength(1);
    await phone.subscriber.leave(phone.servers[0], "token-one");
    await phone.subscriber.idle();
    expect(phone.timers()).toEqual([]);
  });
});

describe("off", () => {
  it("does nothing without a relay URL", async () => {
    const phone = world({ relayUrl: null });
    await phone.check();
    phone.subscriber.tokenSeen("d1");
    phone.subscriber.kindsChanged();
    await phone.subscriber.idle();
    expect(phone.out()).toEqual([]);
    expect(phone.lines).toEqual(["PUSH_SUBSCRIBE off: no relay URL in this build"]);
  });

  it("does nothing where push is unsupported, leaving included", async () => {
    const phone = world({ supported: false });
    await phone.check();
    await phone.subscriber.leave(phone.servers[0], "token-one");
    await phone.subscriber.idle();
    expect(phone.out()).toEqual([]);
    expect(phone.lines).toEqual(["PUSH_SUBSCRIBE off: unsupported on this platform"]);
  });
});

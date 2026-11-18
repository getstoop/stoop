import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "../alertPrefs/prefs";
import { type PushRecord, parseRecord, sameKinds, wantedKinds } from "./record";
import { RelayError, retryAfterMs, subscribeAtRelay } from "./relay";
import { checkedWithinDay, DAY_MS, renewReason, retryDelayMs } from "./renewal";

const NOW = Date.UTC(2026, 10, 17, 12);

const record = (change: Partial<PushRecord> = {}): PushRecord => ({
  session: 1,
  localServerId: "abc123",
  endpoint: "https://relay.example/push/blob",
  issuedAt: NOW - DAY_MS,
  expiresAt: NOW + 29 * DAY_MS,
  vapidKey: "server-key",
  deviceToken: "aabb",
  kinds: [ActivityKind.MENTION],
  checkedAt: NOW - DAY_MS,
  ...change,
});

describe("renewReason", () => {
  it("renews with no record", () => {
    expect(renewReason(null, NOW, "aabb", "server-key")).toBe("no subscription");
  });

  it("renews when the device token or the server's key changed", () => {
    expect(renewReason(record(), NOW, "ccdd", "server-key")).toBe("device token changed");
    expect(renewReason(record(), NOW, "aabb", "new-key")).toBe("server key changed");
  });

  it("renews at 7 days old, not before", () => {
    expect(renewReason(record({ issuedAt: NOW - 7 * DAY_MS }), NOW, "aabb", "server-key")).toBe("7 days old");
    expect(renewReason(record({ issuedAt: NOW - 7 * DAY_MS + 1 }), NOW, "aabb", "server-key")).toBeNull();
  });

  it("renews an endpoint issued in the future (the clock was set back)", () => {
    expect(renewReason(record({ issuedAt: NOW + 1 }), NOW, "aabb", "server-key")).toBe("issued in the future");
  });

  it("only updates otherwise", () => {
    expect(renewReason(record(), NOW, "aabb", "server-key")).toBeNull();
  });
});

describe("checkedWithinDay", () => {
  it("holds for a day and no longer", () => {
    expect(checkedWithinDay(NOW - DAY_MS + 1, NOW)).toBe(true);
    expect(checkedWithinDay(NOW - DAY_MS, NOW)).toBe(false);
    expect(checkedWithinDay(undefined, NOW)).toBe(false);
  });

  it("does not hold for a check dated in the future", () => {
    expect(checkedWithinDay(NOW + 1000, NOW)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("doubles from a minute to at most six hours", () => {
    expect(retryDelayMs(1, null)).toBe(60_000);
    expect(retryDelayMs(2, null)).toBe(120_000);
    expect(retryDelayMs(30, null)).toBe(6 * 60 * 60 * 1000);
  });

  it("waits at least what Retry-After says", () => {
    expect(retryDelayMs(1, 600_000)).toBe(600_000);
    expect(retryDelayMs(3, 1000)).toBe(240_000);
  });
});

describe("parseRecord", () => {
  it("reads back what was saved", () => {
    expect(parseRecord(JSON.stringify(record()))).toEqual(record());
  });

  it("is null for anything else", () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord("not json")).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), endpoint: 3 }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), kinds: ["x"] }))).toBeNull();
  });
});

describe("wantedKinds", () => {
  it("follows the Notifications screen's switches", () => {
    expect(wantedKinds(DEFAULT_PREFS, "abc123")).toEqual([
      ActivityKind.MENTION,
      ActivityKind.REPLY,
      ActivityKind.DM,
      ActivityKind.THREAD_REPLY,
    ]);
    expect(wantedKinds({ ...DEFAULT_PREFS, mentions: false, threads: false }, "abc123")).toEqual([ActivityKind.DM]);
  });

  it("is none for a server whose switch is off", () => {
    expect(wantedKinds({ ...DEFAULT_PREFS, servers: { abc123: false } }, "abc123")).toEqual([]);
    expect(wantedKinds({ ...DEFAULT_PREFS, servers: { other: false } }, "abc123")).toHaveLength(4);
  });

  it("compares in any order", () => {
    expect(sameKinds([ActivityKind.DM, ActivityKind.MENTION], [ActivityKind.MENTION, ActivityKind.DM])).toBe(true);
    expect(sameKinds([ActivityKind.DM], [ActivityKind.MENTION])).toBe(false);
  });
});

describe("the relay", () => {
  const request = { token: "aabb", appId: "org.getstoop.dev", environment: "sandbox" as const, vapidKey: "key" };

  it("posts the subscription and reads the endpoint and its expiry", async () => {
    let sent: { url: string; body: unknown } | null = null;
    const answer = await subscribeAtRelay(
      async (url, init) => {
        sent = { url, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ endpoint: "https://relay.example/push/x", expires_at: "2026-12-17T12:00:00Z" }), {
          status: 201,
        });
      },
      "https://relay.example/",
      request,
      () => NOW,
    );
    expect(sent).toEqual({
      url: "https://relay.example/v1/subscriptions",
      body: { platform: "apns", token: "aabb", app_id: "org.getstoop.dev", environment: "sandbox", vapid_key: "key" },
    });
    expect(answer).toEqual({ endpoint: "https://relay.example/push/x", expiresAt: Date.UTC(2026, 11, 17, 12) });
  });

  it("passes on a 429's Retry-After", async () => {
    const refused = subscribeAtRelay(
      async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }),
      "https://relay.example",
      request,
      () => NOW,
    );
    await expect(refused).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
  });

  it("fails on a network error or an answer without an endpoint", async () => {
    await expect(
      subscribeAtRelay(
        async () => {
          throw new Error("offline");
        },
        "https://relay.example",
        request,
        () => NOW,
      ),
    ).rejects.toBeInstanceOf(RelayError);
    await expect(
      subscribeAtRelay(async () => new Response("{}", { status: 201 }), "https://relay.example", request, () => NOW),
    ).rejects.toMatchObject({ status: 201 });
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("30", NOW)).toBe(30_000);
    expect(retryAfterMs(new Date(NOW + 5000).toUTCString(), NOW)).toBe(5000);
    expect(retryAfterMs("soon", NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
  });
});

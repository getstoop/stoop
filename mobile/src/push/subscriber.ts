import { Code, ConnectError } from "@connectrpc/connect";
import type { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { PushConfig, PushRegistration } from "../api/push";
import type { PushSubscriptionKeys } from "../../modules/stoop-push-keys";
import { type PushRecord, sameKinds } from "./record";
import { RelayError, type RelayEndpoint, type RelaySubscribe } from "./relay";
import { checkedWithinDay, renewReason, retryDelayMs } from "./renewal";

// Each signed-in server's push subscription, kept alive: one session,
// one subscription, its keys under the server's local ID (the ID the
// notification extension will find them by). Everything it touches is
// passed in, so the rules can be tested without a phone.
//
// The check (renewal.ts for its rules) runs for every server when asked:
// at launch, on return to the front, when the notification permission
// is granted, when a server is signed in to, when this phone's device
// token changes and when the kinds wanted change. One that completed is
// not repeated for a day unless the token or the kinds moved; one that
// failed is tried again with backoff. Servers are taken one at a time,
// and a server's removal waits its turn behind them, so nothing writes a
// record back after it was removed.

export type PushServer = { id: string; origin: string; session: number };

export type PushTargetInfo = { appId: string; environment: "sandbox" | "production" | null };

export type SubscriberDeps = {
  // Push is on in this build: a relay is set and the platform has the
  // native module (iOS).
  relayUrl: string | null;
  supported: boolean;
  servers: () => PushServer[];
  sessionToken: (id: string) => Promise<string | null>;
  // The notification permission is granted.
  allowed: () => Promise<boolean>;
  // This phone's APNs device token, hex.
  deviceToken: () => Promise<string>;
  target: () => Promise<PushTargetInfo>;
  ensureKeys: (id: string) => Promise<PushSubscriptionKeys>;
  removeKeys: (id: string) => Promise<void>;
  getConfig: (origin: string, token: string) => Promise<PushConfig>;
  register: (origin: string, token: string, registration: PushRegistration) => Promise<void>;
  update: (origin: string, token: string, kinds: ActivityKind[]) => Promise<void>;
  remove: (origin: string, token: string) => Promise<void>;
  subscribe: (relayUrl: string, request: RelaySubscribe) => Promise<RelayEndpoint>;
  records: {
    get: (id: string) => Promise<PushRecord | null>;
    set: (id: string, record: PushRecord) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
  kinds: (serverId: string) => ActivityKind[];
  now: () => number;
  // Runs done after ms; the returned function calls it off.
  wait: (ms: number, done: () => void) => () => void;
  // A development build's line in Metro's log; never an endpoint, a key or a token.
  log: (line: string) => void;
};

export type PushSubscriber = {
  // Checks every saved server, in turn.
  check: () => void;
  // The platform said this phone's device token; a new one is checked at once.
  tokenSeen: (token: string) => void;
  // The kinds wanted may have changed: servers told other kinds are told again.
  kindsChanged: () => void;
  // The server is being signed out of or removed: it is asked to delete
  // the subscription (best effort), and the phone forgets the keys and
  // the record whatever it said. Resolves once the server has answered
  // or given up, never rejecting; the phone's side follows in turn.
  leave: (server: PushServer, token: string | null) => Promise<void>;
  // Resolves when nothing is left to do (tests).
  idle: () => Promise<void>;
};

type Task =
  | { type: "check"; serverId: string; force: boolean }
  | { type: "leave"; server: PushServer; told: Promise<string> };

type Retry = { failures: number; at: number; cancel: () => void };

// The outcome of a step that failed and why, as the log line says it.
class Failed extends Error {
  readonly original: unknown;
  constructor(step: string, original: unknown) {
    super(`${step}: ${original instanceof Error ? original.message : String(original)}`);
    this.original = original;
  }
}

const codeOf = (error: unknown) => (error instanceof ConnectError ? error.code : null);

export function pushSubscriber(deps: SubscriberDeps): PushSubscriber {
  const relayUrl = deps.supported ? deps.relayUrl : null;
  const on = relayUrl !== null;
  const queue: Task[] = [];
  let running = false;
  let idleWaiters: (() => void)[] = [];
  const retries = new Map<string, Retry>();
  // A check that completed with nothing to keep (push off, no push on the
  // server), by session, so the day holds for it too.
  const doneAt = new Map<string, number>();
  let lastToken: string | null = null;
  let saidOff = false;

  const line = (server: PushServer, outcome: string) => {
    let host = server.origin;
    try {
      host = new URL(server.origin).host;
    } catch {}
    deps.log(`PUSH_SUBSCRIBE ${server.id} ${host} ${outcome}`);
  };

  const sayOff = () => {
    if (saidOff) return;
    saidOff = true;
    deps.log(`PUSH_SUBSCRIBE off: ${deps.supported ? "no relay URL in this build" : "unsupported on this platform"}`);
  };

  const pump = async () => {
    if (running) return;
    running = true;
    for (let task = queue.shift(); task; task = queue.shift()) {
      try {
        if (task.type === "check") await checkServer(task.serverId, task.force);
        else await leaveServer(task);
      } catch {
        // Every step catches its own; nothing stops the queue.
      }
    }
    running = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const waiter of waiters) waiter();
  };

  const enqueueCheck = (serverId: string, force: boolean) => {
    const queued = queue.find((task) => task.type === "check" && task.serverId === serverId);
    if (queued && queued.type === "check") queued.force ||= force;
    else queue.push({ type: "check", serverId, force });
    void pump();
  };

  const checkAll = () => {
    if (!on) return sayOff();
    for (const server of deps.servers()) enqueueCheck(server.id, false);
  };

  const succeeded = (serverId: string) => {
    retries.get(serverId)?.cancel();
    retries.delete(serverId);
  };

  const failed = (server: PushServer, error: Failed) => {
    const before = retries.get(server.id);
    before?.cancel();
    const failures = (before?.failures ?? 0) + 1;
    const delay = retryDelayMs(failures, error.original instanceof RelayError ? error.original.retryAfterMs : null);
    const cancel = deps.wait(delay, () => enqueueCheck(server.id, true));
    retries.set(server.id, { failures, at: deps.now() + delay, cancel });
    line(server, `failed: ${error.message} (retry in ${Math.round(delay / 1000)} s)`);
  };

  // A step that may fail, named for the log.
  const step = async <Result>(name: string, run: () => Promise<Result>): Promise<Result> => {
    try {
      return await run();
    } catch (error) {
      throw new Failed(name, error);
    }
  };

  const checkServer = async (serverId: string, force: boolean) => {
    const server = deps.servers().find((saved) => saved.id === serverId);
    if (!server) return;
    const retry = retries.get(serverId);
    if (retry && deps.now() < retry.at) return line(server, "skipped: waiting to retry");
    if (!(await deps.allowed())) return line(server, "skipped: notifications not allowed");
    const token = await deps.sessionToken(serverId).catch(() => null);
    if (!token) return line(server, "skipped: signed out");
    const session = `${serverId}/${server.session}`;
    try {
      const deviceToken = await step("device token", deps.deviceToken);
      lastToken = deviceToken;
      const stored = await deps.records.get(serverId).catch(() => null);
      const record = stored && stored.session === server.session ? stored : null;
      const kinds = deps.kinds(serverId);
      if (!force) {
        if (
          record &&
          record.deviceToken === deviceToken &&
          sameKinds(record.kinds, kinds) &&
          checkedWithinDay(record.checkedAt, deps.now())
        ) {
          return;
        }
        if (!record && checkedWithinDay(doneAt.get(session), deps.now())) return;
      }
      const target = await deps.target();
      if (!target.environment) {
        succeeded(serverId);
        return line(server, "skipped: this build is not signed for push");
      }
      let config: PushConfig;
      try {
        config = await deps.getConfig(server.origin, token);
      } catch (error) {
        if (codeOf(error) !== Code.Unimplemented) throw new Failed("push config", error);
        succeeded(serverId);
        doneAt.set(session, deps.now());
        return line(server, "skipped: the server has no push");
      }
      if (!config.enabled) {
        succeeded(serverId);
        doneAt.set(session, deps.now());
        return line(server, "skipped: push is off on the server");
      }
      let reason = renewReason(record, deps.now(), deviceToken, config.serverKey);
      if (record && !reason) {
        try {
          await deps.update(server.origin, token, kinds);
        } catch (error) {
          if (codeOf(error) !== Code.NotFound) throw new Failed("update", error);
          reason = "the server had no subscription";
        }
        if (!reason) {
          await step("save record", () => deps.records.set(serverId, { ...record, kinds, checkedAt: deps.now() }));
          succeeded(serverId);
          return line(server, "updated");
        }
      }
      const keys = await step("keys", () => deps.ensureKeys(serverId));
      const environment = target.environment;
      const relay = relayUrl;
      if (!relay) return;
      const issued = await step("relay", () =>
        deps.subscribe(relay, { token: deviceToken, appId: target.appId, environment, vapidKey: config.serverKey }),
      );
      const issuedAt = deps.now();
      await step("register", () =>
        deps.register(server.origin, token, {
          endpoint: issued.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          localServerId: serverId,
          kinds,
        }),
      );
      await step("save record", () =>
        deps.records.set(serverId, {
          session: server.session,
          localServerId: serverId,
          endpoint: issued.endpoint,
          issuedAt,
          expiresAt: issued.expiresAt,
          vapidKey: config.serverKey,
          deviceToken,
          kinds,
          checkedAt: deps.now(),
        }),
      );
      succeeded(serverId);
      line(server, record ? `renewed: ${reason}` : "subscribed");
    } catch (error) {
      const failure = error instanceof Failed ? error : new Failed("check", error);
      if (codeOf(failure.original) === Code.Unauthenticated) {
        succeeded(serverId);
        return line(server, "skipped: signed out");
      }
      failed(server, failure);
    }
  };

  // The phone's side of a removal, in turn behind any check still
  // running for it; the server was asked at once (leave).
  const leaveServer = async ({ server, told }: Extract<Task, { type: "leave" }>) => {
    retries.get(server.id)?.cancel();
    retries.delete(server.id);
    for (const key of doneAt.keys()) if (key.startsWith(`${server.id}/`)) doneAt.delete(key);
    if (!deps.supported) return;
    const keysGone = await deps.removeKeys(server.id).then(
      () => "",
      (error) => `; keys not removed (${error instanceof Error ? error.message : String(error)})`,
    );
    const recordGone = await deps.records.remove(server.id).then(
      () => "",
      (error) => `; record not removed (${error instanceof Error ? error.message : String(error)})`,
    );
    line(server, `removed: ${await told}${keysGone}${recordGone}`);
  };

  return {
    check: checkAll,
    tokenSeen: (token) => {
      if (!on || token === lastToken) return;
      lastToken = token;
      checkAll();
    },
    kindsChanged: () => {
      if (on) checkAll();
    },
    leave: (server, token) => {
      // The server is asked now, not in turn, so the session's end that
      // follows waits on nothing else. A check still running for it may
      // register after this; the session's end takes that with it.
      const told: Promise<string> =
        deps.supported && token
          ? deps.remove(server.origin, token).then(
              () => "told the server",
              (error) => `the server was not told (${error instanceof Error ? error.message : String(error)})`,
            )
          : Promise.resolve("the server was not told (signed out)");
      // A check still waiting for this server is for a session that is ending.
      for (let index = queue.length - 1; index >= 0; index--) {
        const task = queue[index];
        if (task.type === "check" && task.serverId === server.id) queue.splice(index, 1);
      }
      queue.push({ type: "leave", server, told });
      void pump();
      return told.then(() => {});
    },
    idle: () =>
      running || queue.length > 0 ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(),
  };
}

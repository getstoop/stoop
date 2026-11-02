import { create, toBinary } from "@bufbuild/protobuf";
import {
  PresenceChangedSchema,
  ReadySchema,
  type ServerEvent,
  ServerEventSchema,
  UserPresenceSchema,
  VoiceParticipantSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedServer } from "../api/servers";

// The real provider and the real socket, with only WebSocket, the keychain
// and React Native faked. A sign-in to a saved server may be another
// account's, so what is asserted here is what keeps the first account's
// events away from it: the order of a commit, which only React can answer.
// It renders with web's react-dom, the one renderer the tests have, into a
// stub element, so it runs in node with no browser or new dependency.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { keychain, saved, app } = vi.hoisted(() => ({
  keychain: new Map<string, string>(),
  saved: { list: [] as SavedServer[] },
  app: { listeners: new Set<(state: string) => void>() },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_type: string, listener: (state: string) => void) => {
      app.listeners.add(listener);
      return { remove: () => app.listeners.delete(listener) };
    },
  },
}));
vi.mock("../api/servers", () => ({ sessionToken: (id: string) => Promise.resolve(keychain.get(id) ?? null) }));
vi.mock("../servers", () => ({ useServers: () => ({ servers: saved.list }) }));

const log: string[] = [];

class FakeSocket {
  static opened: FakeSocket[] = [];
  bearer: string;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: (event: { code: number }) => void;
  constructor(_url: string, _protocols: null, options: { headers: Record<string, string> }) {
    this.bearer = options.headers.Authorization;
    log.push(`dial ${this.bearer}`);
    FakeSocket.opened.push(this);
  }
  close() {
    log.push(`close ${this.bearer}`);
  }
  say(event: ServerEvent) {
    this.onmessage?.({ data: toBinary(ServerEventSchema, event).slice().buffer });
  }
}
vi.stubGlobal("WebSocket", FakeSocket);
// What the socket asks after a dial that never opened: the keychain's token
// that is over on this server, by bearer, and everything else out of reach.
const over = new Set<string>();
// What the answer waits on, for a test that needs it still out.
let answerWhen = Promise.resolve();
vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
  await answerWhen;
  if (!over.has(new Headers(init?.headers).get("Authorization") ?? "")) {
    throw new TypeError("Network request failed");
  }
  return new Response(JSON.stringify({ code: "unauthenticated", message: "authentication required" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
});
// react-dom looks for a window as it loads, and for this much of an element
// to render into. The tree draws nothing, so nothing else is asked of them.
vi.stubGlobal("window", {});
const { default: RealtimeProvider, usePresence, useServerEvents, useVoiceRoster } = await import("./RealtimeProvider");
const { sessionKey } = await import("../servers/sessionKey");

const ignore = () => {};
const container = {
  nodeType: 1,
  tagName: "DIV",
  addEventListener: ignore,
  removeEventListener: ignore,
  ownerDocument: {
    addEventListener: ignore,
    removeEventListener: ignore,
    defaultView: { document: {}, HTMLIFrameElement: class {} },
  },
} as unknown as Element;

const ALPHA: SavedServer = { id: "aaaaaa", origin: "https://a.example", name: "A", session: 1 };
const BETA: SavedServer = { id: "bbbbbb", origin: "https://b.example", name: "B", session: 1 };
const GAMMA: SavedServer = { id: "cccccc", origin: "https://c.example", name: "C", session: 1 };

const ready = (...userIds: string[]): ServerEvent =>
  create(ServerEventSchema, {
    payload: {
      case: "ready",
      value: create(ReadySchema, {
        presences: userIds.map((userId) => create(UserPresenceSchema, { userId })),
        voiceParticipants: userIds.map((userId) => create(VoiceParticipantSchema, { userId, channelId: "room" })),
      }),
    },
  });
const offline = (userId: string): ServerEvent =>
  create(ServerEventSchema, {
    payload: { case: "presenceChanged", value: create(PresenceChangedSchema, { userId, online: false }) },
  });

// What the first server's stack hears, marked with the session it is on.
const heard: string[] = [];
function Stack() {
  const server = saved.list.find((held) => held.id === ALPHA.id);
  return server ? createElement(Session, { key: sessionKey(server), server }) : null;
}
function Session({ server }: { server: SavedServer }) {
  useServerEvents(server.id, (event) => heard.push(`${sessionKey(server)} ${event.payload.case}`));
  useEffect(() => {
    log.push(`subscribe ${sessionKey(server)}`);
  }, [server]);
  return null;
}

// What one screen on each server reads about sam, and how often it has drawn.
const dots: Record<string, { online: boolean } | undefined> = {};
const voices: Record<string, object | undefined> = {};
const draws: Record<string, number> = {};
function Sam({ serverId }: { serverId: string }) {
  dots[serverId] = usePresence(serverId, "sam");
  voices[serverId] = useVoiceRoster(serverId);
  draws[serverId] = (draws[serverId] ?? 0) + 1;
  return null;
}

const on = (bearer: string) => FakeSocket.opened.findLast((socket) => socket.bearer === `Bearer ${bearer}`);
const speak = (bearer: string, event: ServerEvent) => act(async () => on(bearer)?.say(event));
const keep = (server: SavedServer, token: string) => keychain.set(server.id, token);

describe("RealtimeProvider", () => {
  let root: Root;
  const draw = (...servers: SavedServer[]) => {
    saved.list = servers;
    return act(async () => {
      root.render(
        createElement(
          RealtimeProvider,
          null,
          createElement(Stack),
          createElement(Sam, { serverId: ALPHA.id }),
          createElement(Sam, { serverId: BETA.id }),
        ),
      );
    });
  };
  const appGoes = (state: string) =>
    act(async () => {
      for (const listener of app.listeners) listener(state);
    });

  beforeEach(() => {
    log.length = 0;
    heard.length = 0;
    over.clear();
    keychain.clear();
    FakeSocket.opened = [];
    root = createRoot(container);
    keep(ALPHA, "one");
    keep(BETA, "two");
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  describe("on a new sign-in to a saved server", () => {
    it("closes that socket before the new stack subscribes, then opens one on the new token", async () => {
      await draw(ALPHA, BETA);
      log.length = 0;
      keep(ALPHA, "three");
      await draw({ ...ALPHA, session: 2 }, BETA);
      expect(log).toEqual(["close Bearer one", "subscribe aaaaaa/2", "dial Bearer three"]);
    });

    it("lets nothing from the old socket reach the new session", async () => {
      await draw(ALPHA, BETA);
      await speak("one", ready("sam"));
      const old = on("one");
      heard.length = 0;
      keep(ALPHA, "three");
      await draw({ ...ALPHA, session: 2 }, BETA);
      await act(async () => {
        old?.say(ready("sam"));
        old?.say(offline("june"));
        old?.onclose?.({ code: 1000 });
      });
      expect(heard).toEqual([]);
      expect(dots[ALPHA.id]).toBeUndefined();

      await speak("three", ready("sam"));
      expect(heard).toEqual(["aaaaaa/2 ready"]);
      expect(dots[ALPHA.id]).toMatchObject({ online: true });
    });

    it("clears that server's rosters and leaves another's", async () => {
      await draw(ALPHA, BETA);
      await speak("one", ready("sam"));
      await speak("two", ready("sam"));
      keep(ALPHA, "three");
      await draw({ ...ALPHA, session: 2 }, BETA);
      expect(dots[ALPHA.id]).toBeUndefined();
      expect(voices[ALPHA.id]).toBeUndefined();
      expect(dots[BETA.id]).toMatchObject({ online: true });
      expect(voices[BETA.id]).toBeDefined();
    });
  });

  describe("when a session ends", () => {
    const refuse = (bearer: string) => act(async () => on(bearer)?.onclose?.({ code: 1006 }));

    it("tells that server's screens on a 4001, and no other server's", async () => {
      await draw(ALPHA, BETA);
      await speak("two", ready("sam"));
      await act(async () => on("one")?.onclose?.({ code: 4001 }));
      expect(heard).toEqual(["aaaaaa/1 credentialRevoked"]);
      expect(dots[BETA.id]).toMatchObject({ online: true });
    });

    it("tells them when the server refuses the dial and then says Unauthenticated", async () => {
      await draw(ALPHA, BETA);
      over.add("Bearer one");
      await refuse("one");
      expect(heard).toEqual(["aaaaaa/1 credentialRevoked"]);
      expect(dots[ALPHA.id]).toBeUndefined();
      expect(voices[ALPHA.id]).toBeUndefined();
    });

    it("tells them nothing when the server can't be reached", async () => {
      await draw(ALPHA, BETA);
      await refuse("one");
      expect(heard).toEqual([]);
    });

    it("dials once and stops on coming back to the app", async () => {
      await draw(ALPHA, BETA);
      await appGoes("background");
      over.add("Bearer one");
      heard.length = 0;
      log.length = 0;
      await appGoes("active");
      await refuse("one");
      expect(heard).toEqual(["aaaaaa/1 credentialRevoked"]);
      expect(log.filter((line) => line === "dial Bearer one")).toHaveLength(1);
    });

    it("leaves a new sign-in's stack alone, and opens a socket for it", async () => {
      await draw(ALPHA, BETA);
      over.add("Bearer one");
      await refuse("one");
      heard.length = 0;
      log.length = 0;
      keep(ALPHA, "three");
      await draw({ ...ALPHA, session: 2 }, BETA);
      expect(log).toEqual(["subscribe aaaaaa/2", "dial Bearer three"]);
      await speak("three", ready("sam"));
      expect(heard).toEqual(["aaaaaa/2 ready"]);
    });

    it("says nothing to a new sign-in about the session it replaced", async () => {
      await draw(ALPHA, BETA);
      const old = on("one");
      over.add("Bearer one");
      let answer = () => {};
      answerWhen = new Promise((resolve) => {
        answer = resolve;
      });
      await act(async () => old?.onclose?.({ code: 1006 }));
      keep(ALPHA, "three");
      await draw({ ...ALPHA, session: 2 }, BETA);
      await act(async () => {
        answer();
        old?.onclose?.({ code: 4001 });
      });
      answerWhen = Promise.resolve();
      expect(heard).toEqual([]);
    });
  });

  it("touches no other socket or roster when a server is added or forgotten", async () => {
    keep(GAMMA, "three");
    await draw(ALPHA, BETA);
    await speak("one", ready("sam"));
    await speak("two", ready("sam"));
    log.length = 0;
    await draw(ALPHA, BETA, GAMMA);
    expect(log).toEqual(["dial Bearer three"]);
    log.length = 0;
    await draw(ALPHA, GAMMA);
    expect(log).toEqual(["close Bearer two"]);
    expect(dots[ALPHA.id]).toMatchObject({ online: true });
    expect(dots[BETA.id]).toBeUndefined();
  });

  it("does nothing when switching servers reorders the list", async () => {
    await draw(ALPHA, BETA);
    log.length = 0;
    await draw(BETA, ALPHA);
    expect(log).toEqual([]);
  });

  it("clears one server's rosters when its socket drops", async () => {
    await draw(ALPHA, BETA);
    await speak("one", ready("sam"));
    await speak("two", ready("sam"));
    await act(async () => on("one")?.onclose?.({ code: 1006 }));
    expect(dots[ALPHA.id]).toBeUndefined();
    expect(voices[ALPHA.id]).toBeUndefined();
    expect(dots[BETA.id]).toMatchObject({ online: true });
    expect(voices[BETA.id]).toBeDefined();
  });

  it("answers for the server asked about, and draws only for a change to that answer", async () => {
    await draw(ALPHA, BETA);
    await speak("one", ready("sam"));
    await speak("two", ready("june"));
    expect(dots[ALPHA.id]).toMatchObject({ online: true });
    expect(dots[BETA.id]).toMatchObject({ online: false });

    const drawn = draws[ALPHA.id];
    await speak("two", offline("june"));
    await speak("one", offline("june"));
    expect(draws[ALPHA.id]).toBe(drawn);
    await speak("one", offline("sam"));
    expect(draws[ALPHA.id]).toBe(drawn + 1);
    expect(dots[ALPHA.id]).toMatchObject({ online: false });
  });

  it("closes every socket and clears every roster in the background, and only there", async () => {
    await draw(ALPHA, BETA);
    await speak("one", ready("sam"));
    log.length = 0;
    await appGoes("inactive");
    expect(log).toEqual([]);
    expect(dots[ALPHA.id]).toMatchObject({ online: true });
    await appGoes("background");
    expect(log).toEqual(["close Bearer one", "close Bearer two"]);
    expect(dots[ALPHA.id]).toBeUndefined();
    log.length = 0;
    await appGoes("active");
    expect(log).toEqual(["dial Bearer one", "dial Bearer two"]);
  });
});

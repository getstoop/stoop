import { create, fromBinary } from "@bufbuild/protobuf";
import {
  CredentialRevokedSchema,
  type ServerEvent,
  ServerEventSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { isSessionOver } from "../api/me";

// One server's realtime socket (docs/architecture/realtime.md), reopened
// after a backoff when it drops, as web's is (web/src/api/ws.ts): binary
// ServerEvent frames. It opens as a mobile app (/ws?client=mobile), so
// someone with only this socket open shows as online on mobile, and
// carries the session as a bearer token, as every call from the app does.

const MAX_BACKOFF_MS = 15_000;

// The gateway's close code when the session the socket was opened with
// has ended: signed out, revoked or expired. That session will never work
// again, so this socket stops. A new sign-in replaces it (RealtimeProvider).
const CLOSE_SESSION_ENDED = 4001;

// A session that ended while no socket was open is refused at the upgrade
// (HTTP 401), which React Native reports as an ordinary close, the same as
// a server that is down. So a dial that never opened asks the server, by a
// request that says either way (isSessionOver), and only the server's own
// Unauthenticated counts. An outage answers that too, so it is asked
// sparingly: at once on a socket's first dial, which is how a session already
// over is found on coming back to the app; after a drop, only if the server
// still refuses well past a restart; and then no more often than this, a small
// share of the dials going on at MAX_BACKOFF_MS anyway. The dials keep their
// own schedule meanwhile.
const CHECK_AFTER_DROP_MS = 30_000;
const CHECK_EVERY_MS = 5 * 60_000;

// React Native's WebSocket takes headers as a third argument, which the
// DOM typings this app compiles against don't know.
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: null,
  options: { headers: Record<string, string> },
) => WebSocket;

export type Realtime = { close: () => void };

export function openRealtime(
  origin: string,
  // Read on every attempt rather than held in memory.
  token: () => Promise<string | null>,
  // Every event from the server, and a CredentialRevoked of this socket's
  // own once it has learned, however it learned, that its session has
  // ended, after which it stops.
  onEvent: (event: ServerEvent) => void,
  // Each time the socket closes while still wanted: what it said may be
  // out of date until the next Ready. Neither this nor onEvent is called
  // once close() has been, so a socket being replaced can't speak over
  // its replacement.
  onClose: () => void,
): Realtime {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checkAt = 0;
  // How many sockets have opened: one since a check began has its own answer.
  let opens = 0;

  const stop = () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };

  const ended = () => {
    stop();
    onEvent(create(ServerEventSchema, { payload: { case: "credentialRevoked", value: create(CredentialRevokedSchema) } }));
  };

  // A socket that opened while this was out has been let in since, and is
  // told itself should that stop being so (a 4001).
  const check = async (session: string) => {
    const opensBefore = opens;
    const over = await isSessionOver(origin, session);
    if (over && !closed && opens === opensBefore) ended();
  };

  const connect = async () => {
    const session = await token().catch(() => null);
    if (closed || !session) return;
    const url = `${origin.replace(/^http/, "ws")}/ws?client=mobile`;
    socket = new NativeWebSocket(url, null, { headers: { Authorization: `Bearer ${session}` } });
    socket.binaryType = "arraybuffer";
    let opened = false;
    socket.onopen = () => {
      opened = true;
      opens += 1;
      attempts = 0;
    };
    socket.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (!closed) onEvent(fromBinary(ServerEventSchema, new Uint8Array(e.data)));
    };
    socket.onclose = (e: CloseEvent) => {
      socket = null;
      if (closed) return;
      onClose();
      if (e.code === CLOSE_SESSION_ENDED) {
        ended();
        return;
      }
      const now = Date.now();
      if (opened) {
        checkAt = now + CHECK_AFTER_DROP_MS;
      } else if (now >= checkAt) {
        checkAt = now + CHECK_EVERY_MS;
        void check(session);
      }
      const backoff = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
      attempts += 1;
      timer = setTimeout(connect, backoff);
    };
  };

  connect();
  return { close: stop };
}

import { fromBinary } from "@bufbuild/protobuf";
import { type ServerEvent, ServerEventSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// One server's realtime socket (docs/architecture/realtime.md), reopened
// after a backoff when it drops, as web's is (web/src/api/ws.ts): binary
// ServerEvent frames. It opens as a mobile app (/ws?client=mobile), so
// someone with only this socket open shows as online on mobile, and
// carries the session as a bearer token, as every call from the app does.

const MAX_BACKOFF_MS = 15_000;

// The gateway's close code when the session the socket was opened with
// has ended: signed out, revoked or expired. That session will never work
// again, so the socket waits, still reading the keychain on the backoff,
// until a new sign-in leaves another there.
const CLOSE_SESSION_ENDED = 4001;

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
  // Read again on every attempt, so a new sign-in's session is the one used.
  token: () => Promise<string | null>,
  onEvent: (event: ServerEvent) => void,
  // Each time the socket closes: what it said may be out of date until
  // the next Ready.
  onClose: () => void,
): Realtime {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The session the server said has ended, never tried again.
  let ended: string | null = null;

  const retry = () => {
    const backoff = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
    attempts += 1;
    timer = setTimeout(connect, backoff);
  };

  const connect = async () => {
    const session = await token().catch(() => null);
    if (closed || !session) return;
    if (session === ended) {
      retry();
      return;
    }
    const url = `${origin.replace(/^http/, "ws")}/ws?client=mobile`;
    socket = new NativeWebSocket(url, null, { headers: { Authorization: `Bearer ${session}` } });
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      attempts = 0;
    };
    socket.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      onEvent(fromBinary(ServerEventSchema, new Uint8Array(e.data)));
    };
    socket.onclose = (e: CloseEvent) => {
      socket = null;
      onClose();
      if (closed) return;
      if (e.code === CLOSE_SESSION_ENDED) ended = session;
      retry();
    };
  };

  connect();
  return {
    close: () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}

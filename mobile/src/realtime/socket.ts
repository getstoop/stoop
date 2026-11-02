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
// again, so this socket stops. A new sign-in replaces it (RealtimeProvider),
// and so does the app next coming back to the foreground: that socket opens
// on the same token, is refused at the upgrade (HTTP 401, not this code),
// and retries on the backoff for as long as the app stays open.
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
  // Read on every attempt rather than held in memory.
  token: () => Promise<string | null>,
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

  const connect = async () => {
    const session = await token().catch(() => null);
    if (closed || !session) return;
    const url = `${origin.replace(/^http/, "ws")}/ws?client=mobile`;
    socket = new NativeWebSocket(url, null, { headers: { Authorization: `Bearer ${session}` } });
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      attempts = 0;
    };
    socket.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (!closed) onEvent(fromBinary(ServerEventSchema, new Uint8Array(e.data)));
    };
    socket.onclose = (e: CloseEvent) => {
      socket = null;
      if (closed) return;
      onClose();
      if (e.code === CLOSE_SESSION_ENDED) return;
      const backoff = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
      attempts += 1;
      timer = setTimeout(connect, backoff);
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

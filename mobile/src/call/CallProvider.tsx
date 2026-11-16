import { permissions } from "@livekit/react-native-webrtc";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useEventSubscription, useSendClientEvent } from "../realtime/RealtimeProvider";
import { useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { type Call, type CallHolder, type CallRoom, type Connection, createCall, leavesCall } from "./call";
import CallPlaceProvider from "./CallPlaceProvider";
import { callBarShown, hereChannelId } from "./callBar";
import { openConnection } from "./livekit";

const CallContext = createContext<CallHolder | null>(null);

// Holds the app's one voice call above the router, so it outlives the
// room's screen: leaving that screen keeps the call, and coming back
// finds it. The call itself is call.ts and its LiveKit side livekit.ts;
// this hands them the phone. Where the call is goes to its server over
// the realtime socket, as web reports it (VoiceState), and again after
// each reconnect, since the server forgets with the socket. Going to the
// background leaves the call: the sockets close there, and a call whose
// presence has gone must not stay connected. So does the end of the
// session the call was joined under. The names the call bar shows of
// the call's room are loaded under it (CallPlaceProvider.tsx).
export default function CallProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  const send = useSendClientEvent();
  const subscribe = useEventSubscription();
  const phone = useRef({ servers, send });
  phone.current = { servers, send };

  // Android's permission prompt is another activity, and the app reads
  // as in the background while it is up.
  const asking = useRef(false);
  const [holder] = useState(() =>
    createCall({
      askForMicrophone: async () => {
        asking.current = true;
        try {
          return (await permissions.request({ name: "microphone" })) === true;
        } finally {
          asking.current = false;
        }
      },
      open: (room, events) => {
        const server = phone.current.servers.find((saved) => saved.id === room.serverId);
        if (!server) return noConnection();
        return openConnection(server.origin, room, events);
      },
      report: (serverId, { channelId, muted }) =>
        phone.current.send(serverId, { payload: { case: "voiceState", value: { channelId, muted } } }),
    }),
  );
  const call = useSyncExternalStore(holder.subscribe, holder.get);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (leavesCall(state, asking.current)) void holder.leave();
    });
    return () => sub.remove();
  }, [holder]);

  const room = call && call.status !== "failed" ? call.room : undefined;
  const serverId = room?.serverId;
  useEffect(() => {
    if (!serverId) return;
    return subscribe(serverId, ({ payload }) => {
      if (payload.case === "ready") holder.report();
      else if (payload.case === "credentialRevoked") void holder.leave();
      else if (payload.case === "voiceStateChanged" && payload.value.participant) {
        const { userId, channelId } = payload.value.participant;
        holder.voiceState(serverId, { userId, channelId, joined: payload.value.joined });
      } else if (payload.case === "channelDeleted") holder.roomGone(serverId, payload.value.channelId);
    });
  }, [serverId, subscribe, holder]);

  // The session the call was joined under: signing out, or in again as
  // someone else, ends the call.
  const server = servers.find((saved) => saved.id === serverId);
  const session = server && sessionKey(server);
  const joined = useRef<{ room: CallRoom; session: string | undefined }>(undefined);
  useEffect(() => {
    if (!room) joined.current = undefined;
    else if (joined.current?.room !== room) joined.current = { room, session };
    else if (joined.current.session !== session) void holder.leave();
  }, [room, session, holder]);

  return (
    <CallContext.Provider value={holder}>
      <CallPlaceProvider room={room}>{children}</CallPlaceProvider>
    </CallContext.Provider>
  );
}

// The connection to a server the app no longer has: a join that fails.
const noConnection = (): Connection => ({
  ready: Promise.reject(new Error("no server")),
  userId: () => "",
  setMuted: async () => {},
  chooseOutput: async () => {},
  showOutputPicker: () => {},
  close: async () => {},
});

function useHolder(): CallHolder {
  const holder = useContext(CallContext);
  if (!holder) throw new Error("the call needs a CallProvider above it");
  return holder;
}

// The call the app is in, joining, or failed to join, or null.
export function useCall(): Call | null {
  const holder = useHolder();
  return useSyncExternalStore(holder.subscribe, holder.get);
}

// Whether the call bar shows (callBar.ts callBarShown). Re-renders the
// caller only when that changes.
export function useCallBarShown(): boolean {
  const holder = useHolder();
  return useSyncExternalStore(holder.subscribe, () => callBarShown(holder.get()));
}

// The room on a server this account is in a call in (callBar.ts
// hereChannelId). Re-renders the caller only when that changes, not as
// who is speaking does.
export function useHereChannelId(serverId: string): string | undefined {
  const holder = useHolder();
  return useSyncExternalStore(holder.subscribe, () => hereChannelId(holder.get(), serverId));
}

// What can be done with the call: join, leave, toggleMute, chooseOutput,
// openOutputPicker, dismiss.
export function useCallActions(): Pick<
  CallHolder,
  "join" | "leave" | "toggleMute" | "chooseOutput" | "openOutputPicker" | "dismiss"
> {
  return useHolder();
}

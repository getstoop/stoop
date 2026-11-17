// The app's one voice call: which room it is in, how far the join has
// got, whether the microphone is muted, where its sound comes out and
// who is speaking, and how it holds up when the connection doesn't:
// reconnecting, then back or lost. Plain state
// and its rules, with the phone's parts (the microphone prompt, LiveKit,
// the realtime socket) handed in, so it runs in a test without any of
// them. CallProvider holds one above the router.

import { LOUDSPEAKER, type Output, type OutputKind, sameList, sameOutput } from "./output";

export type CallRoom = { serverId: string; spaceId: string; channelId: string };

export type Call = {
  room: CallRoom;
  // A failed join stays, for its room's screen to say so, until it is
  // dismissed or another join starts. So does a call that was lost.
  status: "connecting" | "connected" | "failed";
  // Why it failed: the microphone was refused, the join failed for any
  // other cause, or the call was connected and its connection was lost
  // for good.
  failure?: "microphone" | "connection" | "lost";
  // Connected, with the connection down and being tried again (LiveKit's
  // own retrying). Nobody is known to be speaking meanwhile.
  reconnecting: boolean;
  muted: boolean;
  // Where the sound comes out now. Every call starts on the loudspeaker,
  // and the phone says when it is anywhere else.
  output: Output;
  // The outputs there are to choose among now, where the app lists them
  // itself (Android). Empty where the system's own picker does (iOS).
  outputs: OutputKind[];
  // The user IDs of whoever is speaking, this account's included.
  speaking: string[];
};

// One connection to a room, opened by CallDeps.open. `ready` settles
// when the join has landed or failed; close() is safe at any point, also
// while `ready` is pending, and more than once.
export type Connection = {
  ready: Promise<void>;
  // This account's user ID, which is its name in the room: known once
  // `ready` has settled, "" before.
  userId: () => string;
  setMuted: (muted: boolean) => Promise<void>;
  // Moves the sound to one of the outputs listed (Android). Rejects
  // when it didn't move.
  chooseOutput: (kind: OutputKind) => Promise<void>;
  // Shows the system's picker of outputs (iOS); nothing where the app
  // lists them itself.
  showOutputPicker: () => void;
  close: () => Promise<void>;
};

export type ConnectionEvents = {
  onSpeaking: (userIds: string[]) => void;
  // Where the sound goes now, and the outputs there are to choose among
  // (empty where the system's picker lists them): said as the call goes
  // live and at each change of either.
  onOutput: (output: Output, outputs: OutputKind[]) => void;
  // The connection is down and being tried again, then back up.
  onReconnecting: () => void;
  onReconnected: () => void;
  // The connection ended and nobody here asked it to: the server took
  // this account out of the room ("removed": out of it, the room
  // deleted, or this account joining it on another device), or anything
  // else, LiveKit giving up on reconnecting included ("lost"). Which
  // of LiveKit's reasons are which is livekit.ts's to say.
  onDropped: (why: "removed" | "lost") => void;
};

export type CallDeps = {
  // Asks for the microphone, with the system's prompt the first time.
  askForMicrophone: () => Promise<boolean>;
  open: (room: CallRoom, events: ConnectionEvents) => Connection;
  // Tells a server where this account is in voice; an empty channelId
  // is "left".
  report: (serverId: string, state: { channelId: string; muted: boolean }) => void;
};

export type CallHolder = {
  get: () => Call | null;
  subscribe: (listener: () => void) => () => void;
  // Joins a room. Already in it, or on the way in: nothing. In another
  // room: leaves that one first.
  join: (room: CallRoom) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  // Moves the sound to one of the call's `outputs`. Nothing for one
  // that isn't among them.
  chooseOutput: (kind: OutputKind) => Promise<void>;
  // Opens the system's picker of outputs, where the phone has one (iOS).
  openOutputPicker: () => void;
  // Says where the call is again: the server forgets when its socket
  // drops.
  report: () => void;
  // What a server says, over its realtime socket, of someone's place in
  // a voice room: in it (said again on each change of theirs), or out of
  // it. This account out of the call's room has been removed (kicked,
  // the room deleted, joined elsewhere on another device), and the call
  // ends; but only once the server has said it is in, see `placed`.
  voiceState: (serverId: string, state: { userId: string; channelId: string; joined: boolean }) => void;
  // A server says a room is no more for this account: deleted, or a
  // private one this account was taken out of. The call in it ends.
  roomGone: (serverId: string, channelId: string) => void;
  // Forgets a failed join, or a lost call.
  dismiss: () => void;
};

export const sameRoom = (one: CallRoom, other: CallRoom) =>
  one.serverId === other.serverId && one.channelId === other.channelId;

// What a room's screen offers at its foot: Join, Join while it connects,
// or the call's controls.
export function footState(call: Call | null, room: CallRoom): "join" | "connecting" | "joined" {
  if (!call || !sameRoom(call.room, room) || call.status === "failed") return "join";
  return call.status === "connecting" ? "connecting" : "joined";
}

// What a room's screen says of a join there that failed, or of a call
// there that was lost, or "".
export function failureLine(call: Call | null, room: CallRoom): string {
  if (!call || !sameRoom(call.room, room) || call.status !== "failed") return "";
  if (call.failure === "microphone") return "Allow the microphone to join.";
  return call.failure === "lost" ? "Call ended. Try again." : "Couldn't join. Try again.";
}

// Whether a room's screen offers the way to the app's page in the
// system's settings: a join there was refused the microphone, which the
// system may not ask for a second time.
export function offersSettings(call: Call | null, room: CallRoom): boolean {
  return !!call && sameRoom(call.room, room) && call.status === "failed" && call.failure === "microphone";
}

// What the call's room's screen and the call bar say while the call's
// connection is being tried again, or "".
export const reconnectingLine = (call: Call | null) =>
  call?.status === "connected" && call.reconnecting ? "Reconnecting…" : "";

// Whether a change in the app's state leaves the call: going to the
// background does, unless it is only the microphone prompt in front.
export const leavesCall = (appState: string, askingForMicrophone: boolean) =>
  appState === "background" && !askingForMicrophone;

export function createCall(deps: CallDeps): CallHolder {
  let call: Call | null = null;
  let connection: Connection | null = null;
  // Counts joins and leaves: a join that finds it moved on has been
  // overtaken and stops.
  let attempt = 0;
  // Every connection left so far, closed: the next is not opened before
  // then, or the last one's close would stop the audio the next started.
  let closing: Promise<void> = Promise.resolve();
  // Whether the server has said this account is in the call's room since
  // the call began, or since the socket last came back (the server
  // forgets with the socket, and is told again). Only then is its saying
  // otherwise a removal. Before, it is old news: a room just left and
  // joined again, the socket before this one closing, or this account
  // leaving the room on another device.
  let placed = false;
  const listeners = new Set<() => void>();

  const set = (next: Call | null) => {
    call = next;
    for (const listener of listeners) listener();
  };

  const report = () => {
    if (call?.status !== "connected") return;
    deps.report(call.room.serverId, { channelId: call.room.channelId, muted: call.muted });
  };

  const close = (open: Connection) => {
    closing = closing.then(() => open.close().catch(() => {}));
    return closing;
  };

  // Ends the call, whoever ended it.
  const end = async () => {
    attempt += 1;
    placed = false;
    const was = call;
    const open = connection;
    connection = null;
    set(null);
    if (was?.status === "connected") deps.report(was.room.serverId, { channelId: "", muted: was.muted });
    if (open) await close(open);
    else await closing;
  };

  // The call's connection is lost for good: the call ends, and stays as
  // failed for its room's screen to say so.
  const lose = async () => {
    const was = call;
    const open = connection;
    if (!was || !open) return;
    attempt += 1;
    placed = false;
    connection = null;
    set({ ...was, status: "failed", failure: "lost", reconnecting: false, speaking: [] });
    deps.report(was.room.serverId, { channelId: "", muted: was.muted });
    await close(open);
  };

  const join = async (room: CallRoom) => {
    // Leaving the room it was in comes first. Anything that happened
    // meanwhile (a leave, the background, another join) overtook this.
    if (call && call.status !== "failed") {
      if (sameRoom(call.room, room)) return;
      const left = end();
      const then = attempt;
      await left;
      if (attempt !== then) return;
    }
    attempt += 1;
    const mine = attempt;
    const fresh = { room, muted: false, output: LOUDSPEAKER, outputs: [], speaking: [], reconnecting: false };
    set({ ...fresh, status: "connecting" });
    const fail = (failure: Call["failure"]) => set({ ...fresh, status: "failed", failure });

    const allowed = await deps.askForMicrophone().catch(() => false);
    await closing;
    if (mine !== attempt) return;
    if (!allowed) {
      fail("microphone");
      return;
    }

    const opened = deps.open(room, {
      onSpeaking: (userIds) => {
        if (connection === opened && call && !call.reconnecting) set({ ...call, speaking: userIds });
      },
      onOutput: (output, outputs) => {
        if (connection !== opened || !call) return;
        if (sameOutput(call.output, output) && sameList(call.outputs, outputs)) return;
        set({ ...call, output, outputs });
      },
      onReconnecting: () => {
        if (connection !== opened || call?.status !== "connected" || call.reconnecting) return;
        set({ ...call, reconnecting: true, speaking: [] });
      },
      onReconnected: () => {
        if (connection === opened && call?.reconnecting) set({ ...call, reconnecting: false });
      },
      // Removed ends silently, as the same news over the realtime socket
      // does (voiceState, roomGone); lost stays for the room's screen.
      onDropped: (why) => {
        if (connection !== opened || call?.status !== "connected") return;
        void (why === "removed" ? end() : lose());
      },
    });
    connection = opened;
    try {
      await opened.ready;
    } catch {
      // Left meanwhile: the leave closed it and said so.
      if (connection !== opened) return;
      connection = null;
      await close(opened);
      if (mine === attempt) fail("connection");
      return;
    }
    if (connection !== opened || !call) return;
    set({ ...call, status: "connected" });
    report();
  };

  const toggleMute = async () => {
    const open = connection;
    if (!open || call?.status !== "connected") return;
    const muted = !call.muted;
    set({ ...call, muted });
    try {
      await open.setMuted(muted);
    } catch {
      // The microphone didn't follow: say what it still is.
      if (connection === open && call?.muted === muted) set({ ...call, muted: !muted });
    }
    if (connection === open) report();
  };

  const chooseOutput = async (kind: OutputKind) => {
    const open = connection;
    if (!open || call?.status !== "connected" || !call.outputs.includes(kind)) return;
    const was = call.output;
    if (was.kind === kind) return;
    const chosen = { kind, name: "" };
    set({ ...call, output: chosen });
    try {
      await open.chooseOutput(kind);
    } catch {
      // The sound didn't move: say where it still is, unless the phone
      // has said since.
      if (connection === open && call?.output === chosen) set({ ...call, output: was });
    }
  };

  const openOutputPicker = () => {
    if (connection && call?.status === "connected") connection.showOutputPicker();
  };

  return {
    get: () => call,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    join,
    leave: end,
    toggleMute,
    chooseOutput,
    openOutputPicker,
    report: () => {
      placed = false;
      report();
    },
    voiceState: (serverId, { userId, channelId, joined }) => {
      if (call?.status !== "connected" || call.room.serverId !== serverId || call.room.channelId !== channelId) return;
      if (userId !== connection?.userId()) return;
      if (joined) placed = true;
      else if (placed) void end();
    },
    roomGone: (serverId, channelId) => {
      if (!call || call.status === "failed") return;
      if (call.room.serverId === serverId && call.room.channelId === channelId) void end();
    },
    dismiss: () => {
      if (call?.status === "failed") set(null);
    },
  };
}

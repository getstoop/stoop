// The app's one voice call: which room it is in, how far the join has
// got, whether the microphone is muted, where its sound comes out and
// who is speaking. Plain state
// and its rules, with the phone's parts (the microphone prompt, LiveKit,
// the realtime socket) handed in, so it runs in a test without any of
// them. CallProvider holds one above the router.

export type CallRoom = { serverId: string; spaceId: string; channelId: string };

export type Call = {
  room: CallRoom;
  // A failed join stays, for its room's screen to say so, until it is
  // dismissed or another join starts.
  status: "connecting" | "connected" | "failed";
  // Why a failed join failed: the microphone was refused, or anything else.
  failure?: "microphone" | "connection";
  muted: boolean;
  // The loudspeaker rather than the earpiece, for when no headphones
  // are connected. Every call starts with it on.
  speaker: boolean;
  // Headphones have the sound, where the phone can tell (Android).
  headphones: boolean;
  // The user IDs of whoever is speaking, this account's included.
  speaking: string[];
};

// One connection to a room, opened by CallDeps.open. `ready` settles
// when the join has landed or failed; close() is safe at any point, also
// while `ready` is pending, and more than once.
export type Connection = {
  ready: Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setSpeaker: (speaker: boolean) => Promise<void>;
  close: () => Promise<void>;
};

export type ConnectionEvents = {
  onSpeaking: (userIds: string[]) => void;
  // Headphones took the sound, or gave it back.
  onHeadphones: (connected: boolean) => void;
  // The connection ended and nobody here asked it to.
  onDropped: () => void;
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
  // Loudspeaker or earpiece. Nothing while headphones have the sound.
  toggleSpeaker: () => Promise<void>;
  // Says where the call is again: the server forgets when its socket
  // drops.
  report: () => void;
  // Forgets a failed join.
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

// What a room's screen says of a join there that failed, or "".
export function failureLine(call: Call | null, room: CallRoom): string {
  if (!call || !sameRoom(call.room, room) || call.status !== "failed") return "";
  return call.failure === "microphone" ? "Allow the microphone to join." : "Couldn't join. Try again.";
}

// What the Speaker control shows: the loudspeaker on or off, or that
// headphones have the sound and it has nothing to switch.
export function speakerState(call: Call | null): "on" | "off" | "headphones" {
  if (call?.headphones) return "headphones";
  return call?.speaker ? "on" : "off";
}

// Android: which output the sound belongs on, of those the phone has
// now: a headset when there is one, else as Speaker says.
export function androidOutput(outputs: string[], speaker: boolean): string {
  const headset = ["bluetooth", "headset"].find((kind) => outputs.includes(kind));
  return headset ?? (speaker ? "speaker" : "earpiece");
}

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
    const was = call;
    const open = connection;
    connection = null;
    set(null);
    if (was?.status === "connected") deps.report(was.room.serverId, { channelId: "", muted: was.muted });
    if (open) await close(open);
    else await closing;
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
    const fresh = { room, muted: false, speaker: true, headphones: false, speaking: [] };
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
        if (connection === opened && call) set({ ...call, speaking: userIds });
      },
      onHeadphones: (connected) => {
        if (connection === opened && call && call.headphones !== connected) set({ ...call, headphones: connected });
      },
      onDropped: () => {
        if (connection === opened && call?.status === "connected") void end();
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

  const toggleSpeaker = async () => {
    const open = connection;
    if (!open || call?.status !== "connected" || call.headphones) return;
    const speaker = !call.speaker;
    set({ ...call, speaker });
    try {
      await open.setSpeaker(speaker);
    } catch {
      // The sound didn't move: say where it still is.
      if (connection === open && call?.speaker === speaker) set({ ...call, speaker: !speaker });
    }
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
    toggleSpeaker,
    report,
    dismiss: () => {
      if (call?.status === "failed") set(null);
    },
  };
}

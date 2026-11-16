import { describe, expect, it } from "vitest";
import {
  androidOutput,
  type CallRoom,
  type ConnectionEvents,
  createCall,
  failureLine,
  footState,
  iosHeadphones,
  leavesCall,
  offersSettings,
  reconnectingLine,
  speakerState,
} from "./call";

const porch: CallRoom = { serverId: "home", spaceId: "space", channelId: "porch" };
const attic: CallRoom = { serverId: "home", spaceId: "space", channelId: "attic" };
const shed: CallRoom = { serverId: "away", spaceId: "yard", channelId: "shed" };

// A connection the test settles by hand.
function fakeConnection(room: CallRoom, events: ConnectionEvents) {
  let land = () => {};
  let fail = (_err: Error) => {};
  const ready = new Promise<void>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  const made = {
    room,
    events,
    ready,
    userId: () => "me",
    land,
    fail: () => fail(new Error("no")),
    closed: 0,
    muted: [] as boolean[],
    refuseMute: false,
    setMuted: async (muted: boolean) => {
      if (made.refuseMute) throw new Error("no");
      made.muted.push(muted);
    },
    speaker: [] as boolean[],
    refuseSpeaker: false,
    setSpeaker: async (speaker: boolean) => {
      if (made.refuseSpeaker) throw new Error("no");
      made.speaker.push(speaker);
    },
    close: async () => {
      made.closed += 1;
    },
  };
  return made;
}

function setup(microphone: boolean | Promise<boolean> = true) {
  const opened: ReturnType<typeof fakeConnection>[] = [];
  const reports: string[] = [];
  const holder = createCall({
    askForMicrophone: async () => microphone,
    open: (room, events) => {
      const made = fakeConnection(room, events);
      opened.push(made);
      return made;
    },
    report: (serverId, state) => reports.push(`${serverId}:${state.channelId || "left"}:${state.muted ? "muted" : "open"}`),
  });
  return { holder, opened, reports };
}

// Lets what a join awaits run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("joining", () => {
  it("connects, then says where it is", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    expect(holder.get()).toMatchObject({ room: porch, status: "connecting", muted: false });
    await settle();
    expect(reports).toEqual([]);
    opened[0].land();
    await joining;
    expect(holder.get()).toMatchObject({ room: porch, status: "connected", muted: false });
    expect(reports).toEqual(["home:porch:open"]);
  });

  it("does not join when the microphone is refused", async () => {
    const { holder, opened, reports } = setup(false);
    await holder.join(porch);
    expect(opened).toEqual([]);
    expect(reports).toEqual([]);
    expect(holder.get()).toMatchObject({ status: "failed", failure: "microphone" });
    expect(footState(holder.get(), porch)).toBe("join");
    expect(failureLine(holder.get(), porch)).toBe("Allow the microphone to join.");
    expect(offersSettings(holder.get(), porch)).toBe(true);
    expect(offersSettings(holder.get(), attic)).toBe(false);
  });

  it("joins after a refusal once the microphone is allowed", async () => {
    let allowed = false;
    const opened: ReturnType<typeof fakeConnection>[] = [];
    const holder = createCall({
      askForMicrophone: async () => allowed,
      open: (room, events) => {
        const made = fakeConnection(room, events);
        opened.push(made);
        return made;
      },
      report: () => {},
    });
    await holder.join(porch);
    expect(offersSettings(holder.get(), porch)).toBe(true);
    // The way to the settings is the background, which ends what is held.
    await holder.leave();
    expect(holder.get()).toBeNull();
    allowed = true;
    const joining = holder.join(porch);
    await settle();
    opened[0].land();
    await joining;
    expect(holder.get()?.status).toBe("connected");
    expect(offersSettings(holder.get(), porch)).toBe(false);
  });

  it("goes back to before the join when the connection fails", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    opened[0].fail();
    await joining;
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual([]);
    expect(holder.get()).toMatchObject({ status: "failed", failure: "connection" });
    expect(footState(holder.get(), porch)).toBe("join");
    expect(failureLine(holder.get(), porch)).toBe("Couldn't join. Try again.");
    expect(failureLine(holder.get(), attic)).toBe("");
    expect(offersSettings(holder.get(), porch)).toBe(false);
  });

  it("joins again after a failure, and forgets one dismissed", async () => {
    const { holder, opened } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].fail();
    await first;
    holder.dismiss();
    expect(holder.get()).toBeNull();
    const second = holder.join(porch);
    await settle();
    opened[1].land();
    await second;
    expect(holder.get()?.status).toBe("connected");
    holder.dismiss();
    expect(holder.get()?.status).toBe("connected");
  });

  it("does nothing for the room it is already in or joining", async () => {
    const { holder, opened } = setup();
    const joining = holder.join(porch);
    await holder.join(porch);
    await settle();
    opened[0].land();
    await joining;
    await holder.join(porch);
    expect(opened).toHaveLength(1);
  });

  it("leaves the first room before joining a second", async () => {
    const { holder, opened, reports } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    const second = holder.join(attic);
    await settle();
    expect(opened[0].closed).toBe(1);
    opened[1].land();
    await second;
    expect(holder.get()).toMatchObject({ room: attic, status: "connected" });
    expect(reports).toEqual(["home:porch:open", "home:left:open", "home:attic:open"]);
  });

  it("leaves a room on one server before joining one on another", async () => {
    const { holder, opened, reports } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    const second = holder.join(shed);
    await settle();
    expect(opened[0].closed).toBe(1);
    expect(opened).toHaveLength(2);
    opened[1].land();
    await second;
    expect(holder.get()).toMatchObject({ room: shed, status: "connected" });
    expect(opened.filter((made) => made.closed === 0)).toHaveLength(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open", "away:shed:open"]);
  });

  it("opens nothing until the call it left has closed", async () => {
    const { holder, opened } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    let closed = () => {};
    opened[0].close = () => new Promise<void>((resolve) => (closed = resolve));
    void holder.leave();
    const again = holder.join(porch);
    await settle();
    expect(opened).toHaveLength(1);
    expect(holder.get()?.status).toBe("connecting");
    closed();
    await settle();
    expect(opened).toHaveLength(2);
    opened[1].land();
    await again;
    expect(holder.get()?.status).toBe("connected");
  });

  it("joins no second room when a leave lands while the first is closing", async () => {
    const { holder, opened } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    let closed = () => {};
    opened[0].close = () => new Promise<void>((resolve) => (closed = resolve));
    const switching = holder.join(attic);
    // The app went to the background.
    const leaving = holder.leave();
    await settle();
    closed();
    await Promise.all([switching, leaving]);
    await settle();
    expect(opened).toHaveLength(1);
    expect(holder.get()).toBeNull();
  });

  it("opens nothing until a failed join has closed", async () => {
    const { holder, opened } = setup();
    const first = holder.join(porch);
    await settle();
    let closed = () => {};
    opened[0].close = () => new Promise<void>((resolve) => (closed = resolve));
    opened[0].fail();
    await settle();
    const second = holder.join(attic);
    await settle();
    expect(opened).toHaveLength(1);
    closed();
    await first;
    await settle();
    expect(opened).toHaveLength(2);
    opened[1].land();
    await second;
    expect(holder.get()).toMatchObject({ room: attic, status: "connected" });
  });

  it("keeps one call when two joins overlap a leave", async () => {
    const { holder, opened } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    const toAttic = holder.join(attic);
    const toPorch = holder.join(porch);
    await settle();
    for (const made of opened.slice(1)) made.land();
    await Promise.all([toAttic, toPorch]);
    const open = opened.filter((made) => made.closed === 0);
    expect(open).toHaveLength(1);
    expect(holder.get()).toMatchObject({ room: open[0].room, status: "connected" });
  });
});

describe("leaving", () => {
  it("closes the connection and says it left", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    opened[0].land();
    await joining;
    await holder.leave();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("stops a join still connecting, and reports nothing", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    await holder.leave();
    opened[0].land();
    await joining;
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual([]);
  });

  it("stops a join still waiting on the microphone prompt", async () => {
    let answer = (_allowed: boolean) => {};
    const { holder, opened } = setup(new Promise<boolean>((resolve) => (answer = resolve)));
    const joining = holder.join(porch);
    await holder.leave();
    answer(true);
    await joining;
    expect(opened).toEqual([]);
    expect(holder.get()).toBeNull();
  });

  it("leaves when the app goes to the background, and says nothing of it", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    opened[0].land();
    await joining;
    expect(leavesCall("inactive", false)).toBe(false);
    expect(leavesCall("active", false)).toBe(false);
    // Android's microphone prompt reads as the background.
    expect(leavesCall("background", true)).toBe(false);
    expect(leavesCall("background", false)).toBe(true);
    await holder.leave();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(failureLine(holder.get(), porch)).toBe("");
    expect(footState(holder.get(), porch)).toBe("join");
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });


  it("ignores a drop from a connection it has already left", async () => {
    const { holder, opened, reports } = setup();
    const first = holder.join(porch);
    await settle();
    opened[0].land();
    await first;
    const second = holder.join(attic);
    await settle();
    opened[1].land();
    await second;
    opened[0].events.onReconnecting();
    opened[0].events.onDropped("lost");
    opened[0].events.onSpeaking(["someone"]);
    await settle();
    expect(holder.get()).toMatchObject({ room: attic, status: "connected", speaking: [], reconnecting: false });
    expect(reports.at(-1)).toBe("home:attic:open");
  });
});

// The connection going down under a call, with nobody having asked.
describe("when the connection drops", () => {
  async function joined() {
    const made = setup();
    const joining = made.holder.join(porch);
    await settle();
    made.opened[0].land();
    await joining;
    return made;
  }

  it("says Reconnecting while it is tried again, in the call's room, and keeps the controls", async () => {
    const { holder, opened, reports } = await joined();
    expect(reconnectingLine(holder.get())).toBe("");
    opened[0].events.onReconnecting();
    expect(holder.get()).toMatchObject({ room: porch, status: "connected", reconnecting: true });
    expect(reconnectingLine(holder.get())).toBe("Reconnecting…");
    expect(footState(holder.get(), porch)).toBe("joined");
    expect(failureLine(holder.get(), porch)).toBe("");
    expect(opened[0].closed).toBe(0);
    expect(reports).toEqual(["home:porch:open"]);
  });

  it("goes back to normal when it reconnects, with nothing said", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].events.onReconnecting();
    opened[0].events.onReconnected();
    expect(holder.get()).toMatchObject({ room: porch, status: "connected", reconnecting: false });
    expect(reconnectingLine(holder.get())).toBe("");
    expect(failureLine(holder.get(), porch)).toBe("");
    expect(reports).toEqual(["home:porch:open"]);
  });

  it("tells whoever listens once, however often it is said to be reconnecting", async () => {
    const { holder, opened } = await joined();
    let changes = 0;
    holder.subscribe(() => {
      changes += 1;
    });
    opened[0].events.onReconnecting();
    opened[0].events.onReconnecting();
    expect(changes).toBe(1);
    opened[0].events.onReconnected();
    opened[0].events.onReconnected();
    expect(changes).toBe(2);
  });

  it("names nobody as speaking while reconnecting", async () => {
    const { holder, opened } = await joined();
    opened[0].events.onSpeaking(["priya"]);
    opened[0].events.onReconnecting();
    expect(holder.get()?.speaking).toEqual([]);
    opened[0].events.onSpeaking(["priya"]);
    expect(holder.get()?.speaking).toEqual([]);
    opened[0].events.onReconnected();
    opened[0].events.onSpeaking(["theo"]);
    expect(holder.get()?.speaking).toEqual(["theo"]);
  });

  it("still mutes and leaves while reconnecting", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].events.onReconnecting();
    await holder.toggleMute();
    expect(holder.get()).toMatchObject({ muted: true, reconnecting: true });
    await holder.leave();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:porch:muted", "home:left:muted"]);
  });

  it("is not reconnecting before the join has landed", async () => {
    const { holder, opened } = setup();
    const joining = holder.join(porch);
    await settle();
    opened[0].events.onReconnecting();
    expect(holder.get()).toMatchObject({ status: "connecting", reconnecting: false });
    opened[0].land();
    await joining;
    expect(reconnectingLine(holder.get())).toBe("");
  });

  it("ends the call as lost when the connection is gone for good, and says so in its room only", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].events.onReconnecting();
    opened[0].events.onDropped("lost");
    await settle();
    expect(holder.get()).toMatchObject({ room: porch, status: "failed", failure: "lost", reconnecting: false });
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
    expect(footState(holder.get(), porch)).toBe("join");
    expect(failureLine(holder.get(), porch)).toBe("Call ended. Try again.");
    expect(failureLine(holder.get(), attic)).toBe("");
    expect(failureLine(holder.get(), shed)).toBe("");
    expect(reconnectingLine(holder.get())).toBe("");
    expect(offersSettings(holder.get(), porch)).toBe(false);
  });

  it("is lost without having been said to be reconnecting, too", async () => {
    const { holder, opened } = await joined();
    opened[0].events.onDropped("lost");
    await settle();
    expect(failureLine(holder.get(), porch)).toBe("Call ended. Try again.");
  });

  it("ends silently when the server took this account out of the room", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].events.onReconnecting();
    opened[0].events.onDropped("removed");
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
    expect(failureLine(holder.get(), porch)).toBe("");
  });

  it("wears the rings again when who is speaking is said after it reconnects", async () => {
    const { holder, opened } = await joined();
    opened[0].events.onSpeaking(["priya"]);
    opened[0].events.onReconnecting();
    opened[0].events.onReconnected();
    expect(holder.get()?.speaking).toEqual([]);
    opened[0].events.onSpeaking(["priya"]);
    expect(holder.get()).toMatchObject({ speaking: ["priya"], reconnecting: false });
  });

  it("forgets a lost call when Join is pressed", async () => {
    const { holder, opened } = await joined();
    opened[0].events.onDropped("lost");
    await settle();
    const again = holder.join(porch);
    expect(holder.get()).toMatchObject({ room: porch, status: "connecting" });
    expect(failureLine(holder.get(), porch)).toBe("");
    await settle();
    opened[1].land();
    await again;
    expect(holder.get()).toMatchObject({ status: "connected", reconnecting: false });
    expect(failureLine(holder.get(), porch)).toBe("");
  });

  it("forgets a lost call when its screen is left, and when any call is joined", async () => {
    const one = await joined();
    one.opened[0].events.onDropped("lost");
    await settle();
    one.holder.dismiss();
    expect(one.holder.get()).toBeNull();

    const other = await joined();
    other.opened[0].events.onDropped("lost");
    await settle();
    const elsewhere = other.holder.join(shed);
    await settle();
    other.opened[1].land();
    await elsewhere;
    expect(other.holder.get()).toMatchObject({ room: shed, status: "connected" });
    expect(failureLine(other.holder.get(), porch)).toBe("");
    expect(other.reports).toEqual(["home:porch:open", "home:left:open", "away:shed:open"]);
  });

  it("forgets a lost call when the app goes to the background", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].events.onDropped("lost");
    await settle();
    await holder.leave();
    expect(holder.get()).toBeNull();
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("says nothing after the user's own leave, a switch of rooms or the background", async () => {
    const left = await joined();
    await left.holder.leave();
    left.opened[0].events.onDropped("lost");
    await settle();
    expect(left.holder.get()).toBeNull();

    // The background leaves the call (CallProvider), also one that was
    // reconnecting.
    const hidden = await joined();
    hidden.opened[0].events.onReconnecting();
    expect(leavesCall("background", false)).toBe(true);
    await hidden.holder.leave();
    hidden.opened[0].events.onDropped("lost");
    await settle();
    expect(hidden.holder.get()).toBeNull();
    expect(failureLine(hidden.holder.get(), porch)).toBe("");

    const switched = await joined();
    const moving = switched.holder.join(attic);
    switched.opened[0].events.onDropped("lost");
    await settle();
    switched.opened[1].land();
    await moving;
    expect(switched.holder.get()).toMatchObject({ room: attic, status: "connected" });
    expect(failureLine(switched.holder.get(), porch)).toBe("");
  });

  it("keeps a lost call's line when the server then says this account left, or the room went", async () => {
    const { holder, opened, reports } = await joined();
    holder.voiceState("home", { userId: "me", channelId: "porch", joined: true });
    opened[0].events.onDropped("lost");
    await settle();
    holder.voiceState("home", { userId: "me", channelId: "porch", joined: false });
    await settle();
    expect(failureLine(holder.get(), porch)).toBe("Call ended. Try again.");
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("says nothing when the server's removal is heard first, whatever the connection says after", async () => {
    const { holder, opened } = await joined();
    holder.voiceState("home", { userId: "me", channelId: "porch", joined: true });
    opened[0].events.onReconnecting();
    holder.voiceState("home", { userId: "me", channelId: "porch", joined: false });
    opened[0].events.onDropped("lost");
    await settle();
    expect(holder.get()).toBeNull();
    expect(failureLine(holder.get(), porch)).toBe("");

    const gone = await joined();
    gone.opened[0].events.onReconnecting();
    gone.holder.roomGone("home", "porch");
    gone.opened[0].events.onDropped("lost");
    await settle();
    expect(gone.holder.get()).toBeNull();
  });
});

describe("in a call", () => {
  async function joined() {
    const made = setup();
    const joining = made.holder.join(porch);
    await settle();
    made.opened[0].land();
    await joining;
    return made;
  }

  it("mutes and unmutes, and reports each", async () => {
    const { holder, opened, reports } = await joined();
    await holder.toggleMute();
    expect(holder.get()?.muted).toBe(true);
    await holder.toggleMute();
    expect(holder.get()?.muted).toBe(false);
    expect(opened[0].muted).toEqual([true, false]);
    expect(reports).toEqual(["home:porch:open", "home:porch:muted", "home:porch:open"]);
  });

  it("stays as it was when the microphone won't follow", async () => {
    const { holder, opened, reports } = await joined();
    opened[0].refuseMute = true;
    await holder.toggleMute();
    expect(holder.get()?.muted).toBe(false);
    expect(reports.at(-1)).toBe("home:porch:open");
  });

  it("mutes nothing outside a call", async () => {
    const { holder, opened, reports } = setup();
    await holder.toggleMute();
    const joining = holder.join(porch);
    await settle();
    await holder.toggleMute();
    expect(holder.get()?.muted).toBe(false);
    opened[0].land();
    await joining;
    expect(opened[0].muted).toEqual([]);
    expect(reports).toEqual(["home:porch:open"]);
  });

  it("starts on the loudspeaker, and switches to the earpiece and back", async () => {
    const { holder, opened, reports } = await joined();
    expect(holder.get()?.speaker).toBe(true);
    expect(speakerState(holder.get())).toBe("on");
    await holder.toggleSpeaker();
    expect(holder.get()?.speaker).toBe(false);
    expect(speakerState(holder.get())).toBe("off");
    await holder.toggleSpeaker();
    expect(speakerState(holder.get())).toBe("on");
    expect(opened[0].speaker).toEqual([false, true]);
    // Where the sound comes out is nobody else's business.
    expect(reports).toEqual(["home:porch:open"]);
  });

  it("stays as it was when the sound won't move", async () => {
    const { holder, opened } = await joined();
    opened[0].refuseSpeaker = true;
    await holder.toggleSpeaker();
    expect(holder.get()?.speaker).toBe(true);
  });

  it("starts every call on the loudspeaker again", async () => {
    const { holder, opened } = await joined();
    await holder.toggleSpeaker();
    expect(holder.get()?.speaker).toBe(false);
    await holder.leave();
    const again = holder.join(porch);
    expect(holder.get()?.speaker).toBe(true);
    await settle();
    opened[1].land();
    await again;
    expect(speakerState(holder.get())).toBe("on");
    await holder.toggleSpeaker();
    const moving = holder.join(attic);
    await settle();
    opened[2].land();
    await moving;
    expect(holder.get()).toMatchObject({ room: attic, speaker: true, headphones: false });
    expect(opened[2].speaker).toEqual([]);
  });

  it("switches nothing while headphones have the sound, and keeps what was chosen", async () => {
    const { holder, opened } = await joined();
    await holder.toggleSpeaker();
    opened[0].events.onHeadphones(true);
    expect(speakerState(holder.get())).toBe("headphones");
    await holder.toggleSpeaker();
    expect(opened[0].speaker).toEqual([false]);
    opened[0].events.onHeadphones(false);
    expect(speakerState(holder.get())).toBe("off");
  });

  it("keeps the choice when a press finds headphones nobody had seen yet", async () => {
    const { holder, opened } = await joined();
    opened[0].setSpeaker = async () => {
      opened[0].events.onHeadphones(true);
      throw new Error("headphones have the sound");
    };
    await holder.toggleSpeaker();
    expect(holder.get()).toMatchObject({ speaker: true, headphones: true });
    opened[0].events.onHeadphones(false);
    expect(speakerState(holder.get())).toBe("on");
  });

  it("tells nobody of headphones that haven't changed", async () => {
    const { holder, opened } = await joined();
    let changes = 0;
    holder.subscribe(() => (changes += 1));
    opened[0].events.onHeadphones(false);
    opened[0].events.onHeadphones(true);
    opened[0].events.onHeadphones(true);
    expect(changes).toBe(1);
  });

  it("switches no speaker outside a call", async () => {
    const { holder, opened } = setup();
    await holder.toggleSpeaker();
    expect(speakerState(holder.get())).toBe("off");
    const joining = holder.join(porch);
    await settle();
    await holder.toggleSpeaker();
    expect(holder.get()?.speaker).toBe(true);
    opened[0].land();
    await joining;
    expect(opened[0].speaker).toEqual([]);
  });

  it("ignores headphones on a connection it has left", async () => {
    const { holder, opened } = await joined();
    const moving = holder.join(attic);
    await settle();
    opened[1].land();
    await moving;
    opened[0].events.onHeadphones(true);
    expect(holder.get()?.headphones).toBe(false);
  });

  it("puts Android's sound on a headset when there is one, else where Speaker says", () => {
    expect(androidOutput(["speaker", "earpiece"], true)).toBe("speaker");
    expect(androidOutput(["speaker", "earpiece"], false)).toBe("earpiece");
    expect(androidOutput(["headset", "speaker"], false)).toBe("headset");
    expect(androidOutput(["bluetooth", "speaker", "earpiece"], true)).toBe("bluetooth");
    expect(androidOutput(["headset", "bluetooth", "speaker"], true)).toBe("bluetooth");
    expect(androidOutput([], true)).toBe("speaker");
  });

  it("counts anything but the iPhone's own loudspeaker and earpiece as headphones", () => {
    expect(iosHeadphones([{ kind: "speaker" }])).toBe(false);
    expect(iosHeadphones([{ kind: "earpiece" }])).toBe(false);
    expect(iosHeadphones([{ kind: "headphones" }])).toBe(true);
    expect(iosHeadphones([{ kind: "bluetooth" }])).toBe(true);
    expect(iosHeadphones([{ kind: "other" }])).toBe(true);
    expect(iosHeadphones([{ kind: "speaker" }, { kind: "other" }])).toBe(true);
    expect(iosHeadphones([])).toBe(false);
  });

  it("says where it is again when asked, and only while connected", async () => {
    const { holder, reports } = await joined();
    await holder.toggleMute();
    holder.report();
    expect(reports.at(-1)).toBe("home:porch:muted");
    await holder.leave();
    const count = reports.length;
    holder.report();
    expect(reports).toHaveLength(count);
  });

  it("follows who is speaking", async () => {
    const { holder, opened } = await joined();
    opened[0].events.onSpeaking(["ada", "bea"]);
    expect(holder.get()?.speaking).toEqual(["ada", "bea"]);
    opened[0].events.onSpeaking([]);
    expect(holder.get()?.speaking).toEqual([]);
  });

  it("tells whoever listens of every change", async () => {
    const { holder } = await joined();
    let changes = 0;
    const stop = holder.subscribe(() => (changes += 1));
    await holder.toggleMute();
    stop();
    await holder.leave();
    expect(changes).toBe(1);
  });

  it("offers the controls only in the call's own room", async () => {
    const { holder } = await joined();
    expect(footState(holder.get(), porch)).toBe("joined");
    expect(footState(holder.get(), attic)).toBe("join");
    expect(footState(holder.get(), { ...porch, serverId: "other" })).toBe("join");
  });
});

// What the server says, over its socket, of who is in the call's room.
describe("when the server says where this account is", () => {
  async function joined() {
    const made = setup();
    const joining = made.holder.join(porch);
    await settle();
    made.opened[0].land();
    await joining;
    return made;
  }
  const said = (room: CallRoom, joined: boolean, userId = "me") =>
    [room.serverId, { userId, channelId: room.channelId, joined }] as const;

  it("ends the call when it says this account has left the room", async () => {
    const { holder, opened, reports } = await joined();
    holder.voiceState(...said(porch, true));
    expect(holder.get()?.status).toBe("connected");
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(footState(holder.get(), porch)).toBe("join");
    expect(failureLine(holder.get(), porch)).toBe("");
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("keeps the call until the server has said this account is in the room", async () => {
    const { holder, opened } = await joined();
    // Between the join and its report landing: this account leaving the
    // same room on another device, say.
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()?.status).toBe("connected");
    expect(opened[0].closed).toBe(0);
  });

  it("hears nothing of its own leave", async () => {
    const { holder, opened, reports } = await joined();
    holder.voiceState(...said(porch, true));
    await holder.leave();
    holder.voiceState(...said(porch, false));
    await settle();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("keeps the room it switched to when the one it left is said to be left", async () => {
    const { holder, opened } = await joined();
    holder.voiceState(...said(porch, true));
    const moving = holder.join(attic);
    await settle();
    holder.voiceState(...said(porch, false));
    expect(holder.get()).toMatchObject({ room: attic, status: "connecting" });
    opened[1].land();
    await moving;
    holder.voiceState(...said(porch, false));
    holder.voiceState(...said(attic, true));
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toMatchObject({ room: attic, status: "connected" });
    expect(opened[1].closed).toBe(0);
  });

  it("keeps a room joined again when the leave before it is heard late", async () => {
    const { holder, opened } = await joined();
    holder.voiceState(...said(porch, true));
    await holder.leave();
    const again = holder.join(porch);
    await settle();
    opened[1].land();
    await again;
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toMatchObject({ room: porch, status: "connected" });
    holder.voiceState(...said(porch, true));
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[1].closed).toBe(1);
  });

  it("keeps the call over a reconnect, until the server has heard where it is again", async () => {
    const { holder, opened, reports } = await joined();
    holder.voiceState(...said(porch, true));
    // The socket came back with a fresh Ready: the server forgot, and the
    // socket before it closing there says this account left.
    holder.report();
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()?.status).toBe("connected");
    expect(reports).toEqual(["home:porch:open", "home:porch:open"]);
    holder.voiceState(...said(porch, true));
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
  });

  it("stays placed through its own mute", async () => {
    const { holder } = await joined();
    holder.voiceState(...said(porch, true));
    await holder.toggleMute();
    holder.voiceState(...said(porch, true));
    expect(holder.get()).toMatchObject({ status: "connected", muted: true });
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toBeNull();
  });

  it("ignores anyone else, any other room and any other server", async () => {
    const { holder } = await joined();
    holder.voiceState(...said(porch, true));
    holder.voiceState(...said(porch, false, "bea"));
    holder.voiceState(...said(attic, false));
    holder.voiceState(...said(attic, true));
    holder.voiceState(...said({ ...porch, serverId: "away" }, false));
    await settle();
    expect(holder.get()?.status).toBe("connected");
  });

  it("is not placed by someone else, or while still connecting", async () => {
    const { holder, opened } = setup();
    const joining = holder.join(porch);
    await settle();
    // This account, in the room on another device, leaves it there.
    holder.voiceState(...said(porch, true));
    holder.voiceState(...said(porch, false));
    expect(holder.get()?.status).toBe("connecting");
    opened[0].land();
    await joining;
    holder.voiceState(...said(porch, true, "bea"));
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()?.status).toBe("connected");
  });

  it("says nothing twice when the connection said it was removed first", async () => {
    const { holder, opened, reports } = await joined();
    holder.voiceState(...said(porch, true));
    opened[0].events.onDropped("removed");
    holder.voiceState(...said(porch, false));
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("ends the call when its room is gone, placed or not", async () => {
    const { holder, opened, reports } = await joined();
    holder.roomGone("away", porch.channelId);
    holder.roomGone("home", attic.channelId);
    expect(holder.get()?.status).toBe("connected");
    holder.roomGone("home", porch.channelId);
    await settle();
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(footState(holder.get(), porch)).toBe("join");
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
  });

  it("stops a join into a room that is gone, and keeps a failed join's line", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    holder.roomGone("home", porch.channelId);
    opened[0].land();
    await joining;
    expect(holder.get()).toBeNull();
    expect(opened[0].closed).toBe(1);
    expect(reports).toEqual([]);

    const failing = holder.join(attic);
    await settle();
    opened[1].fail();
    await failing;
    holder.roomGone("home", attic.channelId);
    expect(failureLine(holder.get(), attic)).toBe("Couldn't join. Try again.");
  });
});

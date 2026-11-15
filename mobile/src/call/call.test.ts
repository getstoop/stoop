import { describe, expect, it } from "vitest";
import { type CallRoom, type ConnectionEvents, createCall, failureLine, footState } from "./call";

const porch: CallRoom = { serverId: "home", spaceId: "space", channelId: "porch" };
const attic: CallRoom = { serverId: "home", spaceId: "space", channelId: "attic" };

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
    land,
    fail: () => fail(new Error("no")),
    closed: 0,
    muted: [] as boolean[],
    refuseMute: false,
    setMuted: async (muted: boolean) => {
      if (made.refuseMute) throw new Error("no");
      made.muted.push(muted);
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
    expect(failureLine(holder.get(), porch)).toMatch(/microphone/);
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

  it("ends a call that is dropped", async () => {
    const { holder, opened, reports } = setup();
    const joining = holder.join(porch);
    await settle();
    opened[0].land();
    await joining;
    opened[0].events.onDropped();
    await settle();
    expect(holder.get()).toBeNull();
    expect(reports).toEqual(["home:porch:open", "home:left:open"]);
    expect(footState(holder.get(), porch)).toBe("join");
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
    opened[0].events.onDropped();
    opened[0].events.onSpeaking(["someone"]);
    await settle();
    expect(holder.get()).toMatchObject({ room: attic, status: "connected", speaking: [] });
    expect(reports.at(-1)).toBe("home:attic:open");
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

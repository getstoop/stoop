import { describe, expect, it } from "vitest";
import type { Call } from "./call";
import {
  CALL_BAR_HEIGHT,
  type CallPlace,
  callBarLabel,
  callBarName,
  callBarShown,
  callBarStatus,
  callPillClearance,
  hereChannelId,
  ROOM_ROUTE,
  screensOverRoom,
  speakingLine,
  speakingNames,
  tabRow,
} from "./callBar";

const call = (over: Partial<Call> = {}): Call => ({
  room: { serverId: "home", spaceId: "space", channelId: "porch" },
  status: "connected",
  muted: false,
  output: { kind: "speaker", name: "" },
  outputs: [],
  speaking: [],
  reconnecting: false,
  ...over,
});

const place: CallPlace = {
  roomName: "Porch",
  spaceName: "Neighbors",
  meId: "me",
  names: { me: "John", priya: "Priya", theo: "Theo", sam: "Sam" },
};

describe("when the call bar shows", () => {
  it("shows in a call and on the way into one", () => {
    expect(callBarShown(call())).toBe(true);
    expect(callBarShown(call({ status: "connecting" }))).toBe(true);
    expect(callBarShown(call({ reconnecting: true }))).toBe(true);
  });

  it("shows nothing with no call, for a join that failed, or for a call that was lost", () => {
    expect(callBarShown(null)).toBe(false);
    expect(callBarShown(call({ status: "failed", failure: "connection" }))).toBe(false);
    expect(callBarShown(call({ status: "failed", failure: "lost" }))).toBe(false);
  });

  it("takes the server chip's row, with one server too", () => {
    expect(tabRow(callBarShown(call()), 2)).toBe("call");
    expect(tabRow(callBarShown(call()), 1)).toBe("call");
    expect(tabRow(callBarShown(call({ status: "connecting" })), 1)).toBe("call");
  });

  it("gives the row back when the call ends", () => {
    expect(tabRow(callBarShown(null), 2)).toBe("chip");
    expect(tabRow(callBarShown(null), 1)).toBe(null);
    expect(tabRow(callBarShown(call({ status: "failed" })), 2)).toBe("chip");
  });
});

describe("the room the call pill takes under a header", () => {
  it("is the bar's height and the gap under it, in a call and on the way in", () => {
    expect(callPillClearance(callBarShown(call()))).toBe(CALL_BAR_HEIGHT + 8);
    expect(callPillClearance(callBarShown(call({ status: "connecting" })))).toBe(CALL_BAR_HEIGHT + 8);
  });

  it("is nothing with no call, or for a join that failed", () => {
    expect(callPillClearance(callBarShown(null))).toBe(0);
    expect(callPillClearance(callBarShown(call({ status: "failed", failure: "connection" })))).toBe(0);
  });
});

describe("going back to the call's room", () => {
  const porch = { serverId: "home", spaceId: "space", channelId: "porch" };
  const room = (channelId: string) => ({ name: ROOM_ROUTE, params: { id: "home", spaceId: "space", channelId } });
  const tabs = { name: "(tabs)" };
  const channel = { name: "space/[spaceId]/channel/[channelId]/index", params: { channelId: "garden" } };
  const thread = { name: "space/[spaceId]/channel/[channelId]/thread/[rootId]", params: { channelId: "porch" } };

  it("pops the screens over the room when it is in the stack", () => {
    expect(screensOverRoom([tabs, room("porch"), thread], 2, porch)).toBe(1);
    expect(screensOverRoom([tabs, room("porch"), thread, channel, thread], 4, porch)).toBe(3);
  });

  it("pushes when the room isn't there", () => {
    expect(screensOverRoom([tabs, channel], 1, porch)).toBeUndefined();
    expect(screensOverRoom([tabs], 0, porch)).toBeUndefined();
    expect(screensOverRoom([{ name: "index" }], 0, porch)).toBeUndefined();
  });

  it("takes another room, or the room's own chat as a thread's channel, for no room", () => {
    expect(screensOverRoom([tabs, room("stoop"), thread], 2, porch)).toBeUndefined();
    expect(screensOverRoom([tabs, thread, channel], 2, porch)).toBeUndefined();
  });

  it("goes to the nearest copy, and counts nothing past the screen in front", () => {
    expect(screensOverRoom([tabs, room("porch"), thread, room("porch"), thread], 4, porch)).toBe(1);
    expect(screensOverRoom([tabs, channel, room("porch")], 1, porch)).toBeUndefined();
  });
});

describe("the bar's status line", () => {
  it("says who is speaking", () => {
    expect(callBarStatus(call({ speaking: ["priya"] }), place, "")).toBe("Priya is speaking");
    expect(callBarStatus(call({ speaking: ["priya", "theo"] }), place, "")).toBe("Priya and Theo are speaking");
    expect(callBarStatus(call({ speaking: ["priya", "theo", "sam"] }), place, "")).toBe(
      "Priya and 2 others are speaking",
    );
  });

  it("leaves this account out of who is speaking", () => {
    expect(callBarStatus(call({ speaking: ["me", "theo"] }), place, "")).toBe("Theo is speaking");
    expect(callBarStatus(call({ speaking: ["me"] }), place, "")).toBe("Neighbors");
  });

  it("names the space while nobody is speaking", () => {
    expect(callBarStatus(call(), place, "")).toBe("Neighbors");
  });

  it("says Connecting on the way in, whoever is speaking", () => {
    expect(callBarStatus(call({ status: "connecting", speaking: ["priya"] }), place, "")).toBe("Connecting…");
  });

  it("says Reconnecting while the connection is tried again, whoever was speaking", () => {
    expect(callBarStatus(call({ reconnecting: true, speaking: ["priya"] }), place, "")).toBe("Reconnecting…");
    expect(callBarStatus(call({ reconnecting: true }), place, "Hutch House")).toBe("Hutch House · Reconnecting…");
    expect(callBarStatus(call({ reconnecting: true }), undefined, "")).toBe("Reconnecting…");
  });

  it("names the call's server first when another server is on screen", () => {
    expect(callBarStatus(call({ speaking: ["theo"] }), place, "Hutch House")).toBe("Hutch House · Theo is speaking");
    expect(callBarStatus(call(), place, "Hutch House")).toBe("Hutch House · Neighbors");
    expect(callBarStatus(call({ status: "connecting" }), place, "Hutch House")).toBe("Hutch House · Connecting…");
  });

  it("says what it can before the names have loaded", () => {
    expect(callBarStatus(call(), undefined, "")).toBe("In a call");
    expect(callBarStatus(call(), undefined, "Hutch House")).toBe("Hutch House");
    expect(callBarStatus(call({ speaking: ["priya"] }), undefined, "")).toBe("In a call");
    expect(callBarName(undefined)).toBe("Voice room");
    expect(callBarName({ ...place, roomName: "" })).toBe("Voice room");
    expect(callBarName(place)).toBe("Porch");
  });

  it("names nobody while this account isn't known", () => {
    expect(callBarStatus(call({ speaking: ["me", "priya"] }), { ...place, meId: "" }, "")).toBe("Neighbors");
  });

  it("calls someone the members don't have Someone", () => {
    expect(speakingNames(call({ speaking: ["new", "priya"] }), place)).toEqual(["Someone", "Priya"]);
  });

  it("says nothing for nobody", () => {
    expect(speakingLine([])).toBe("");
  });

  it("is read out with the room and the way back", () => {
    expect(callBarLabel("Porch", "Priya is speaking")).toBe("In Porch. Priya is speaking. Back to the call");
  });
});

describe("the room marked on the Spaces tab", () => {
  it("is the call's, on its server, once the join has landed", () => {
    expect(hereChannelId(call(), "home")).toBe("porch");
    expect(hereChannelId(call(), "away")).toBeUndefined();
    expect(hereChannelId(call({ status: "connecting" }), "home")).toBeUndefined();
    expect(hereChannelId(call({ status: "failed" }), "home")).toBeUndefined();
    expect(hereChannelId(null, "home")).toBeUndefined();
  });
});

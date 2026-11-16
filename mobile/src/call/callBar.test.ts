import { describe, expect, it } from "vitest";
import type { Call } from "./call";
import {
  type CallPlace,
  callBarLabel,
  callBarName,
  callBarShown,
  callBarStatus,
  hereChannelId,
  speakingLine,
  speakingNames,
  tabRow,
} from "./callBar";

const call = (over: Partial<Call> = {}): Call => ({
  room: { serverId: "home", spaceId: "space", channelId: "porch" },
  status: "connected",
  muted: false,
  speaker: true,
  headphones: false,
  speaking: [],
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
  });

  it("shows nothing with no call, or for a join that failed", () => {
    expect(callBarShown(null)).toBe(false);
    expect(callBarShown(call({ status: "failed", failure: "connection" }))).toBe(false);
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

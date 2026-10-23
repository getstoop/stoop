import { describe, expect, it } from "vitest";
import { channelPath, messagePath, threadPath } from "./shareLinks";

const SPACE = "spc_porch";
const CHANNEL = "chn_stoop";
const DM = "chn_dm_ada";
const MESSAGE = "msg_7f3a";

describe("channelPath", () => {
  it("builds a space channel", () => {
    expect(channelPath(SPACE, CHANNEL)).toBe(`/s/${SPACE}/c/${CHANNEL}`);
  });

  it("builds a DM when there is no space", () => {
    expect(channelPath("", DM)).toBe(`/dm/${DM}`);
  });
});

describe("messagePath", () => {
  it("hangs ?m= off the channel it belongs to", () => {
    expect(messagePath(SPACE, CHANNEL, MESSAGE)).toBe(
      `/s/${SPACE}/c/${CHANNEL}?m=${MESSAGE}`,
    );
    expect(messagePath("", DM, MESSAGE)).toBe(`/dm/${DM}?m=${MESSAGE}`);
  });

  // The message id is escaped; the space and channel ids are passed
  // through as they come, so they must stay opaque server ids.
  it("escapes the message id", () => {
    expect(messagePath(SPACE, CHANNEL, "msg a&b")).toBe(
      `/s/${SPACE}/c/${CHANNEL}?m=msg%20a%26b`,
    );
  });
});

describe("threadPath", () => {
  it("builds a thread link, with the reply when there is one", () => {
    expect(threadPath(SPACE, CHANNEL, "root1")).toBe(
      `/s/${SPACE}/c/${CHANNEL}?t=root1`,
    );
    expect(threadPath(SPACE, CHANNEL, "root1", MESSAGE)).toBe(
      `/s/${SPACE}/c/${CHANNEL}?t=root1&m=${MESSAGE}`,
    );
    expect(threadPath("", DM, "root1", "root1")).toBe(`/dm/${DM}?t=root1`);
  });

  it("escapes the root and the reply", () => {
    expect(threadPath(SPACE, CHANNEL, "root a", "msg &")).toBe(
      `/s/${SPACE}/c/${CHANNEL}?t=root%20a&m=msg%20%26`,
    );
  });
});

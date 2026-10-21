import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageSchema,
} from "../../../gen/stoop/chat/v1/message_pb";
import { edgesReached, newestChange } from "./edges";

const message = (id: string): Message =>
  create(MessageSchema, { id, channelId: "c1" });

describe("edgesReached", () => {
  it("reaches neither edge in the middle of a long window", () => {
    expect(edgesReached({ startIndex: 40, endIndex: 60 }, 120, 4)).toEqual({
      older: false,
      newer: false,
    });
  });

  it("reaches the older edge within the lead of the first row", () => {
    expect(edgesReached({ startIndex: 4, endIndex: 20 }, 120, 4).older).toBe(
      true,
    );
    expect(edgesReached({ startIndex: 5, endIndex: 20 }, 120, 4).older).toBe(
      false,
    );
  });

  it("reaches the newer edge within the lead of the last row", () => {
    expect(edgesReached({ startIndex: 100, endIndex: 115 }, 120, 4).newer).toBe(
      true,
    );
    expect(edgesReached({ startIndex: 100, endIndex: 114 }, 120, 4).newer).toBe(
      false,
    );
  });

  it("a short window has both edges on screen", () => {
    expect(edgesReached({ startIndex: 0, endIndex: 5 }, 6, 4)).toEqual({
      older: true,
      newer: true,
    });
  });

  it("no range or no rows reaches nothing", () => {
    expect(edgesReached(null, 10, 4)).toEqual({ older: false, newer: false });
    expect(edgesReached({ startIndex: 0, endIndex: 0 }, 0, 4)).toEqual({
      older: false,
      newer: false,
    });
  });
});

describe("newestChange", () => {
  const a = message("a");
  const b = message("b");
  const c = message("c");

  it("is first until a window was seen", () => {
    expect(newestChange(undefined, [])).toBe("first");
    expect(newestChange(undefined, [a, b])).toBe("first");
  });

  it("is an arrival when one message extends the end", () => {
    expect(newestChange("b", [a, b, c])).toBe("arrival");
  });

  it("is the same when the newest stays, whatever happened above it", () => {
    expect(newestChange("b", [a, b])).toBe("same");
    expect(newestChange("b", [c, a, b])).toBe("same");
  });

  it("is replaced when the window was swapped or pruned past the newest", () => {
    expect(newestChange("a", [b, c])).toBe("replaced");
    expect(newestChange("a", [])).toBe("replaced");
    expect(newestChange("a", [a, b, c])).toBe("replaced");
  });
});

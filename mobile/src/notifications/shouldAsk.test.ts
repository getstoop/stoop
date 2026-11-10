import { describe, expect, it } from "vitest";
import { shouldAsk } from "./shouldAsk";

describe("shouldAsk", () => {
  it("asks on iOS while the person hasn't answered", () => {
    expect(shouldAsk({ status: "undetermined", granted: false, canAskAgain: true }, "ios")).toBe(true);
  });

  it("doesn't ask on iOS once refused", () => {
    expect(shouldAsk({ status: "denied", granted: false, canAskAgain: true }, "ios")).toBe(false);
  });

  it("asks on Android while not granted and still askable", () => {
    expect(shouldAsk({ status: "denied", granted: false, canAskAgain: true }, "android")).toBe(true);
  });

  it("doesn't ask on Android once granted", () => {
    expect(shouldAsk({ status: "granted", granted: true, canAskAgain: true }, "android")).toBe(false);
  });

  it("doesn't ask on Android once the system won't show the prompt", () => {
    expect(shouldAsk({ status: "denied", granted: false, canAskAgain: false }, "android")).toBe(false);
  });
});

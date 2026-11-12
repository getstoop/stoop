import { describe, expect, it } from "vitest";
import { isRefused } from "./refused";

describe("isRefused", () => {
  it("is not refused before the app has asked", () => {
    expect(isRefused({ status: "undetermined", granted: false, canAskAgain: true }, "ios")).toBe(false);
    expect(isRefused({ status: "undetermined", granted: false, canAskAgain: true }, "android")).toBe(false);
  });

  it("is not refused once granted", () => {
    expect(isRefused({ status: "granted", granted: true, canAskAgain: true }, "ios")).toBe(false);
    expect(isRefused({ status: "granted", granted: true, canAskAgain: false }, "android")).toBe(false);
  });

  it("is refused on iOS once denied", () => {
    expect(isRefused({ status: "denied", granted: false, canAskAgain: true }, "ios")).toBe(true);
    expect(isRefused({ status: "denied", granted: false, canAskAgain: false }, "ios")).toBe(true);
  });

  it("is not refused on Android while the app may still ask, whatever it reports", () => {
    expect(isRefused({ status: "denied", granted: false, canAskAgain: true }, "android")).toBe(false);
  });

  it("is refused on Android when this run asked and it is still not granted", () => {
    expect(isRefused({ status: "denied", granted: false, canAskAgain: true }, "android", true)).toBe(true);
  });

  it("is not refused after an ask this run once granted", () => {
    expect(isRefused({ status: "granted", granted: true, canAskAgain: true }, "android", true)).toBe(false);
  });

  it("is refused on Android once it may not ask again", () => {
    expect(isRefused({ status: "denied", granted: false, canAskAgain: false }, "android")).toBe(true);
  });
});

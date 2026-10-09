import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { inviteGone } from "./invites";

describe("inviteGone", () => {
  it("is the server saying the invite can't be used", () => {
    for (const code of [
      Code.NotFound,
      Code.FailedPrecondition,
      Code.ResourceExhausted,
    ]) {
      expect(inviteGone(new ConnectError("gone", code))).toBe(true);
    }
  });

  it("is not a failure worth retrying", () => {
    expect(inviteGone(new ConnectError("down", Code.Unavailable))).toBe(false);
    expect(inviteGone(new ConnectError("oops", Code.Internal))).toBe(false);
    expect(inviteGone(new TypeError("Failed to fetch"))).toBe(false);
  });
});

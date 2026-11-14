import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { joinFailure } from "./invites";

describe("joinFailure", () => {
  it("gives the server's words for a refusal", () => {
    const removed = new ConnectError("you've been removed from this space and can't rejoin", Code.PermissionDenied);
    expect(joinFailure(removed)).toEqual({
      kind: "refused",
      message: "you've been removed from this space and can't rejoin",
    });
    expect(joinFailure(new ConnectError("this invite has been used up", Code.ResourceExhausted))).toEqual({
      kind: "refused",
      message: "this invite has been used up",
    });
  });

  it("says the session is over only when the server does", () => {
    expect(joinFailure(new ConnectError("sign in first", Code.Unauthenticated))).toEqual({ kind: "ended" });
  });

  it("takes anything else for the server not being reached", () => {
    expect(joinFailure(new ConnectError("timed out", Code.DeadlineExceeded))).toEqual({ kind: "unreachable" });
    expect(joinFailure(new ConnectError("no route", Code.Unavailable))).toEqual({ kind: "unreachable" });
    expect(joinFailure(new ConnectError("boom", Code.Internal))).toEqual({ kind: "unreachable" });
    expect(joinFailure(new TypeError("Network request failed"))).toEqual({ kind: "unreachable" });
  });
});

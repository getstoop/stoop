import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { searchErrorText } from "./search";

describe("searchErrorText", () => {
  it("names the rate limit as something to wait out", () => {
    const err = new ConnectError("slow down", Code.ResourceExhausted);
    expect(searchErrorText(err)).toBe(
      "Too many searches. Try again in a minute.",
    );
  });

  it("suggests narrowing a search that timed out", () => {
    const err = new ConnectError("deadline", Code.DeadlineExceeded);
    expect(searchErrorText(err)).toBe(
      "That search took too long. Add a channel or a word.",
    );
  });

  it("passes any other server message through as it came", () => {
    const err = new ConnectError("bad query near OR", Code.InvalidArgument);
    expect(searchErrorText(err)).toBe("bad query near OR");
  });

  it("falls back to whatever a non-Connect failure said", () => {
    expect(searchErrorText(new Error("offline"))).toBe("offline");
  });
});

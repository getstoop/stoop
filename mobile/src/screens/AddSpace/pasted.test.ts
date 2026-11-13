import { describe, expect, it } from "vitest";
import { inviteLink, pasted } from "./pasted";

const here = "https://chat.example.org";

describe("pasted", () => {
  it("is empty until something is typed", () => {
    expect(pasted("", here)).toEqual({ kind: "empty" });
    expect(pasted("   ", here)).toEqual({ kind: "empty" });
  });

  it("takes a link to this server for its code", () => {
    expect(pasted("https://chat.example.org/join/k3Xq9TzR", here)).toEqual({ kind: "here", code: "k3Xq9TzR" });
    expect(pasted("  chat.example.org/join/k3Xq9TzR?space=books ", here)).toEqual({ kind: "here", code: "k3Xq9TzR" });
  });

  it("says which server another one's link is for", () => {
    expect(pasted("https://other.example.org/join/k3Xq9TzR", here)).toEqual({
      kind: "elsewhere",
      origin: "https://other.example.org",
      code: "k3Xq9TzR",
    });
    // The same host over plain HTTP is another address.
    expect(pasted("http://chat.example.org/join/k3Xq9TzR", here)).toEqual({
      kind: "elsewhere",
      origin: "http://chat.example.org",
      code: "k3Xq9TzR",
    });
  });

  it("refuses a bare code and a link to somewhere else on the server", () => {
    expect(pasted("k3Xq9TzR", here)).toEqual({ kind: "not-link" });
    expect(pasted("https://chat.example.org/s/books", here)).toEqual({ kind: "not-link" });
  });
});

describe("inviteLink", () => {
  it("writes the link out as the server does", () => {
    expect(inviteLink({ origin: "https://other.example.org", code: "k3Xq9TzR" })).toBe(
      "https://other.example.org/join/k3Xq9TzR",
    );
  });

  it("reads back as the same link", () => {
    const link = { origin: "https://other.example.org", code: "a b/c" };
    expect(pasted(inviteLink(link), "https://chat.example.org")).toEqual({ kind: "elsewhere", ...link });
  });
});

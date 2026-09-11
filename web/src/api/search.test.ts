import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  highlightPattern,
  highlightTerms,
  inChannel,
  searchErrorText,
  toggleInChannel,
} from "./search";

// What a query highlights: the terms, then the words they mark in a
// message, which is the pair the reader actually sees.
const marks = (query: string, text: string): string[] => {
  const pattern = highlightPattern(highlightTerms(query));
  return pattern ? [...text.matchAll(pattern)].map((m) => m[0]) : [];
};

describe("highlightTerms", () => {
  it("lowercases the words of a plain query", () => {
    expect(highlightTerms("Ada Lovelace")).toEqual(["ada", "lovelace"]);
  });

  it("has nothing to highlight in an empty or blank query", () => {
    expect(highlightTerms("")).toEqual([]);
    expect(highlightTerms("   ")).toEqual([]);
    expect(highlightTerms("\n\t ")).toEqual([]);
  });

  it("collapses runs of whitespace", () => {
    expect(highlightTerms("  ada   bea  ")).toEqual(["ada", "bea"]);
  });

  it("drops the filters the server parses", () => {
    expect(highlightTerms("from:casey in:#general deploy")).toEqual(["deploy"]);
    expect(highlightTerms("before:2026-01-01 after:2025-01-01")).toEqual([]);
  });

  it("drops a filter key written in any case", () => {
    expect(highlightTerms("From:casey hi")).toEqual(["hi"]);
  });

  it("drops a negated word", () => {
    expect(highlightTerms("deploy -staging")).toEqual(["deploy"]);
  });

  it("drops OR, which joins terms rather than being one", () => {
    expect(highlightTerms("cats OR dogs")).toEqual(["cats", "dogs"]);
  });

  it("turns a quoted phrase into its words", () => {
    expect(highlightTerms('"ship it" now')).toEqual(["ship", "it", "now"]);
  });

  it("drops the wildcard from a prefix search", () => {
    expect(highlightTerms("deplo*")).toEqual(["deplo"]);
  });

  it("keeps an apostrophe or a hyphen inside a word", () => {
    expect(highlightTerms("don't well-known")).toEqual(["don't", "well-known"]);
  });

  it("splits a word off its punctuation", () => {
    expect(highlightTerms("ship it, then?")).toEqual(["ship", "it", "then"]);
  });

  it("keeps a colon that is not a known filter", () => {
    expect(highlightTerms("note:this")).toEqual(["note", "this"]);
    expect(highlightTerms(":ship")).toEqual(["ship"]);
  });

  // A pasted link is words to this side, since the server indexes it as
  // words too; over-highlighting beats a URL that matches nothing.
  it("breaks a pasted URL into its words", () => {
    expect(highlightTerms("https://example.com/logs")).toEqual([
      "https",
      "example",
      "com",
      "logs",
    ]);
  });
});

describe("highlightPattern", () => {
  it("has no pattern when there are no terms", () => {
    expect(highlightPattern([])).toBeNull();
  });

  it("matches the term at the start of a word, whatever its case", () => {
    expect(marks("ada", "Ada met ada")).toEqual(["Ada", "ada"]);
  });

  it("carries the match to the end of the word, so a prefix hits", () => {
    expect(marks("deplo", "deployed twice")).toEqual(["deployed"]);
  });

  it("does not match inside a word", () => {
    expect(marks("ada", "Canada")).toEqual([]);
  });

  it("stops the match at an apostrophe", () => {
    expect(marks("casey", "casey's turn")).toEqual(["casey"]);
  });

  it("matches a word after a hyphen", () => {
    expect(marks("known", "well-known")).toEqual(["known"]);
  });

  it("matches non-ASCII words", () => {
    expect(marks("café", "Café ouvert")).toEqual(["Café"]);
  });

  it("takes a term with regex characters literally", () => {
    const pattern = highlightPattern(["a.b"]);
    expect("axb".match(pattern as RegExp)).toBeNull();
    expect("a.b here".match(pattern as RegExp)).toEqual(["a.b"]);
  });

  it("finds every term in the query", () => {
    expect(marks("ship it", "ship it now, ship again")).toEqual([
      "ship",
      "it",
      "ship",
    ]);
  });
});

describe("inChannel", () => {
  it("sees the channel filter anywhere in the query", () => {
    expect(inChannel("in:#general deploy", "general")).toBe(true);
    expect(inChannel("deploy in:#general", "general")).toBe(true);
  });

  it("ignores the case of the filter as typed", () => {
    expect(inChannel("IN:#General", "general")).toBe(true);
  });

  it("is false for another channel or no filter", () => {
    expect(inChannel("in:#random deploy", "general")).toBe(false);
    expect(inChannel("deploy", "general")).toBe(false);
    expect(inChannel("", "general")).toBe(false);
  });

  it("needs the whole token, not a channel whose name starts the same", () => {
    expect(inChannel("in:#general-chat", "general")).toBe(false);
  });
});

describe("toggleInChannel", () => {
  it("adds the filter at the front", () => {
    expect(toggleInChannel("deploy", "general")).toBe("in:#general deploy");
  });

  it("removes the filter it already carries", () => {
    expect(toggleInChannel("in:#general deploy", "general")).toBe("deploy");
    expect(toggleInChannel("deploy in:#general", "general")).toBe("deploy");
  });

  it("replaces a filter pointing at another channel", () => {
    expect(toggleInChannel("in:#random deploy", "general")).toBe(
      "in:#general deploy",
    );
  });

  it("filters an empty query, and clears back to empty", () => {
    expect(toggleInChannel("", "general")).toBe("in:#general");
    expect(toggleInChannel("in:#general", "general")).toBe("");
  });

  it("tidies the spacing left behind", () => {
    expect(toggleInChannel("  in:#general   deploy  ", "general")).toBe(
      "deploy",
    );
  });

  it("leaves the other filters alone", () => {
    expect(toggleInChannel("from:casey deploy", "general")).toBe(
      "in:#general from:casey deploy",
    );
  });
});

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
    expect(searchErrorText(new Error("offline"))).toBe("Error: offline");
  });
});

// Channel names are only length-checked by the server, so a #General is a
// real thing. The token was lowercased and the name was not, so its chip
// never read as active and every click re-added the filter.
describe("inChannel with a capitalised channel name", () => {
  it("recognises its own filter", () => {
    expect(inChannel("in:#general hello", "General")).toBe(true);
    expect(inChannel("in:#General hello", "General")).toBe(true);
  });

  it("so the chip turns off again", () => {
    const on = toggleInChannel("hello", "General");
    expect(on).toBe("in:#General hello");
    expect(toggleInChannel(on, "General")).toBe("hello");
  });
});

import { describe, expect, it } from "vitest";
import {
  hasChannelFilter,
  highlightPattern,
  highlightTerms,
  inChannel,
  queryTokens,
  toggleInChannel,
  withoutChannelFilter,
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

// As the server's tokenizeSearch reads a query.
describe("queryTokens", () => {
  it("splits on whitespace, dropping the blanks", () => {
    expect(queryTokens("  ship   it \n now")).toEqual(["ship", "it", "now"]);
    expect(queryTokens("")).toEqual([]);
  });

  it("keeps a quoted phrase one token, with its quotes", () => {
    expect(queryTokens('"sign in:" error')).toEqual(['"sign in:"', "error"]);
  });

  it("keeps a quoted filter value with its key", () => {
    expect(queryTokens('in:"front steps" x')).toEqual([
      'in:"front steps"',
      "x",
    ]);
  });

  it("runs an unclosed quote to the end", () => {
    expect(queryTokens('a "b c')).toEqual(["a", '"b c']);
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

  // The server takes the name with or without its #, and a quoted value
  // without its quotes.
  it("takes the filter without the #, as the server does", () => {
    expect(inChannel("in:general deploy", "general")).toBe(true);
    expect(inChannel("IN:General deploy", "general")).toBe(true);
    expect(inChannel('in:"#general" deploy', "general")).toBe(true);
  });

  it("sees a quoted name with a space in it", () => {
    expect(inChannel('in:"front steps" deploy', "front steps")).toBe(true);
  });

  it("is not fooled by in: inside a phrase", () => {
    expect(inChannel('"sign in:#general" deploy', "general")).toBe(false);
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

  it("replaces a quoted filter whole, and leaves a phrase alone", () => {
    expect(toggleInChannel('in:"front steps" deploy', "general")).toBe(
      "in:#general deploy",
    );
    expect(toggleInChannel('"sign in:" error', "general")).toBe(
      'in:#general "sign in:" error',
    );
  });
});

describe("hasChannelFilter", () => {
  it("sees a filter for any channel, anywhere, in any case", () => {
    expect(hasChannelFilter("in:#general deploy")).toBe(true);
    expect(hasChannelFilter("deploy IN:#Random")).toBe(true);
  });

  it("is false without one", () => {
    expect(hasChannelFilter("deploy from:casey")).toBe(false);
    expect(hasChannelFilter("")).toBe(false);
  });

  it("reads quotes as the server does", () => {
    expect(hasChannelFilter('"sign in:" error')).toBe(false);
    expect(hasChannelFilter('in:"front steps" error')).toBe(true);
  });
});

describe("withoutChannelFilter", () => {
  it("drops every channel filter and keeps the rest", () => {
    expect(withoutChannelFilter("in:#general deploy in:#random")).toBe(
      "deploy",
    );
    expect(withoutChannelFilter("from:casey deploy")).toBe("from:casey deploy");
  });

  it("tidies the spacing and clears back to empty", () => {
    expect(withoutChannelFilter("  in:#general   deploy  ")).toBe("deploy");
    expect(withoutChannelFilter("in:#general")).toBe("");
  });

  it("drops a quoted filter whole, and leaves a phrase alone", () => {
    expect(withoutChannelFilter('in:"front steps" error')).toBe("error");
    expect(withoutChannelFilter('"sign in:" error')).toBe('"sign in:" error');
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

import { describe, expect, it } from "vitest";
import { noMatchParts } from "./noMatch";

describe("noMatchParts", () => {
  it("keeps a query with no channel filter whole", () => {
    expect(noMatchParts("chapter 99")).toEqual({ words: "chapter 99", channel: null });
  });

  it("takes the channel out of the words and names it", () => {
    expect(noMatchParts("in:#chapters chapter 99")).toEqual({ words: "chapter 99", channel: "chapters" });
    expect(noMatchParts("chapter 99 IN:#Chapters")).toEqual({ words: "chapter 99", channel: "Chapters" });
  });

  it("drops the quotes round a channel name", () => {
    expect(noMatchParts('in:"#porch" keys')).toEqual({ words: "keys", channel: "porch" });
  });

  it("names no channel for a filter with nothing after it", () => {
    expect(noMatchParts("in:# keys")).toEqual({ words: "keys", channel: null });
  });
});

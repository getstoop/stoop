import { describe, expect, it } from "vitest";
import { NO_LAST_SPACES, parseLastSpaces, withoutServer, withSpace } from "./lastSpaces";

describe("parseLastSpaces", () => {
  it("is empty for nothing saved or what can't be read", () => {
    expect(parseLastSpaces(null)).toEqual({});
    expect(parseLastSpaces("")).toEqual({});
    expect(parseLastSpaces("{nope")).toEqual({});
    expect(parseLastSpaces("null")).toEqual({});
    expect(parseLastSpaces("3")).toEqual({});
    expect(parseLastSpaces('["books"]')).toEqual({});
  });

  it("reads a saved map back", () => {
    const saved = { home: "books", work: "standup" };
    expect(parseLastSpaces(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps what it can of a partly bad save", () => {
    expect(parseLastSpaces(JSON.stringify({ home: "books", work: 3, club: "", gym: null }))).toEqual({
      home: "books",
    });
  });
});

describe("withSpace", () => {
  it("sets one server's space and leaves the others", () => {
    expect(withSpace({ home: "books" }, "work", "standup")).toEqual({ home: "books", work: "standup" });
    expect(withSpace({ home: "books" }, "home", "garden")).toEqual({ home: "garden" });
  });

  it("is the same object when nothing changes", () => {
    const spaces = { home: "books" };
    expect(withSpace(spaces, "home", "books")).toBe(spaces);
  });
});

describe("withoutServer", () => {
  it("drops one server's space", () => {
    expect(withoutServer({ home: "books", work: "standup" }, "home")).toEqual({ work: "standup" });
  });

  it("is the same object when the server had none", () => {
    expect(withoutServer(NO_LAST_SPACES, "home")).toBe(NO_LAST_SPACES);
  });
});

import { describe, expect, it } from "vitest";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { filterCandidates } from "./candidates";

const author = (
  id: string,
  username: string,
  displayName = "",
): MessageAuthor => ({ id, username, displayName }) as MessageAuthor;

const people = [
  author("u1", "casey", "Casey Q"),
  author("u2", "ada", "Ada W."),
  author("u3", "bea"),
];

describe("filterCandidates", () => {
  it("is everyone when nothing is typed", () => {
    expect(filterCandidates(people, "").map((p) => p.id)).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
  });

  it("drops the people already in the conversation", () => {
    expect(filterCandidates(people, "", ["u1", "u3"]).map((p) => p.id)).toEqual(
      ["u2"],
    );
  });

  it("matches the username", () => {
    expect(filterCandidates(people, "be").map((p) => p.id)).toEqual(["u3"]);
  });

  it("matches the display name too", () => {
    expect(filterCandidates(people, "ada w").map((p) => p.id)).toEqual(["u2"]);
  });

  it("ignores case and surrounding space", () => {
    expect(filterCandidates(people, "  CASEY ").map((p) => p.id)).toEqual([
      "u1",
    ]);
  });

  it("is empty when nothing matches", () => {
    expect(filterCandidates(people, "zz")).toEqual([]);
  });
});

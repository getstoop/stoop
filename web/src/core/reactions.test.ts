import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";
import { toggledReactions } from "./reactions";

const reaction = (emoji: string, userIds: string[]): Reaction =>
  create(ReactionSchema, { emoji, userIds });

const shape = (reactions: Reaction[]) =>
  reactions.map((r) => [r.emoji, r.userIds]);

describe("toggledReactions", () => {
  it("adds a new group last", () => {
    const before = [reaction("👍", ["ada"])];
    expect(shape(toggledReactions(before, "🎉", "casey"))).toEqual([
      ["👍", ["ada"]],
      ["🎉", ["casey"]],
    ]);
  });

  it("joins a group that already exists", () => {
    const before = [reaction("👍", ["ada", "bea"])];
    expect(shape(toggledReactions(before, "👍", "casey"))).toEqual([
      ["👍", ["ada", "bea", "casey"]],
    ]);
  });

  it("leaves a group the user is already in", () => {
    const before = [reaction("👍", ["ada", "casey", "bea"])];
    expect(shape(toggledReactions(before, "👍", "casey"))).toEqual([
      ["👍", ["ada", "bea"]],
    ]);
  });

  it("drops the group when the last user leaves", () => {
    const before = [reaction("👍", ["casey"]), reaction("🎉", ["ada"])];
    expect(shape(toggledReactions(before, "👍", "casey"))).toEqual([
      ["🎉", ["ada"]],
    ]);
  });

  it("keeps the other groups and their order", () => {
    const before = [
      reaction("👍", ["ada"]),
      reaction("🎉", ["bea"]),
      reaction("🚀", ["casey"]),
    ];
    expect(shape(toggledReactions(before, "🎉", "casey"))).toEqual([
      ["👍", ["ada"]],
      ["🎉", ["bea", "casey"]],
      ["🚀", ["casey"]],
    ]);
  });

  // toggleReaction hands the same array back to setReactions when the
  // RPC fails, so the optimistic pass must not have touched it.
  it("does not touch the list it was given", () => {
    const before = [reaction("👍", ["ada"])];
    toggledReactions(before, "👍", "casey");
    toggledReactions(before, "🎉", "casey");
    expect(shape(before)).toEqual([["👍", ["ada"]]]);
  });

  it("starts a list that was empty", () => {
    expect(shape(toggledReactions([], "👍", "casey"))).toEqual([
      ["👍", ["casey"]],
    ]);
  });
});

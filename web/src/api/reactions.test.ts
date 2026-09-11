import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";
import { setReactions, toggledReactions } from "./reactions";

// api/clients.ts builds its transport from location.origin as it loads,
// and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

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

describe("setReactions", () => {
  const message = (id: string, channelId: string): Message =>
    ({ id, channelId, reactions: [] }) as unknown as Message;

  const cached = (qc: QueryClient, channelId: string) =>
    qc.getQueryData<Message[]>(["messages", channelId]);

  it("replaces the list on one message", () => {
    const qc = new QueryClient();
    qc.setQueryData<Message[]>(
      ["messages", "chan1"],
      [message("m1", "chan1"), message("m2", "chan1")],
    );
    setReactions(qc, "chan1", "m2", [reaction("👍", ["casey"])]);
    const after = cached(qc, "chan1");
    expect(shape(after?.[0].reactions ?? [])).toEqual([]);
    expect(shape(after?.[1].reactions ?? [])).toEqual([["👍", ["casey"]]]);
  });

  // A replaced message is a new object, so the list a memoised row reads
  // from actually changes.
  it("copies the message rather than mutating it", () => {
    const qc = new QueryClient();
    const original = message("m1", "chan1");
    qc.setQueryData<Message[]>(["messages", "chan1"], [original]);
    setReactions(qc, "chan1", "m1", [reaction("👍", ["ada"])]);
    expect(cached(qc, "chan1")?.[0]).not.toBe(original);
    expect(original.reactions).toEqual([]);
  });

  it("does nothing for a message the cache has not loaded", () => {
    const qc = new QueryClient();
    qc.setQueryData<Message[]>(["messages", "chan1"], [message("m1", "chan1")]);
    setReactions(qc, "chan1", "gone", [reaction("👍", ["ada"])]);
    expect(shape(cached(qc, "chan1")?.[0].reactions ?? [])).toEqual([]);
  });

  // An event can land for a channel nobody has opened; it must not
  // create a half-empty cache entry that a later query would trust.
  it("does not create a cache entry for an unloaded channel", () => {
    const qc = new QueryClient();
    setReactions(qc, "chan9", "m1", [reaction("👍", ["ada"])]);
    expect(cached(qc, "chan9")).toBeUndefined();
  });
});

import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";
import { setReactions } from "./reactions";

// api/clients.ts builds its transport from location.origin as it loads,
// and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

const reaction = (emoji: string, userIds: string[]): Reaction =>
  create(ReactionSchema, { emoji, userIds });

const shape = (reactions: Reaction[]) =>
  reactions.map((r) => [r.emoji, r.userIds]);

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

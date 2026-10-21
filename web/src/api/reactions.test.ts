import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";
import { openChannel } from "./channelLog";
import {
  CHANNEL,
  id,
  logOf,
  postOnServer,
  resetServer,
} from "./channelLogTestServer";
import { setReactions, toggleReaction } from "./reactions";

const { listMessages, listChanges, toggle } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listChanges: vi.fn(),
  toggle: vi.fn(),
}));
vi.mock("./clients", () => ({
  chatClient: { listMessages, listChanges, toggleReaction: toggle },
}));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));
vi.mock("../stores/dialogs", () => ({ notice: vi.fn() }));

const reaction = (emoji: string, userIds: string[]): Reaction =>
  create(ReactionSchema, { emoji, userIds });

const shape = (messageId: string) =>
  logOf()
    .rows.get(messageId)
    ?.reactions.map((one) => [one.emoji, one.userIds]);

beforeEach(async () => {
  resetServer(listMessages, listChanges);
  toggle.mockReset();
  await openChannel(CHANNEL);
});

describe("setReactions", () => {
  it("replaces the list on one held row, as a new object at its seq", () => {
    const original = logOf().rows.get(id(390));
    setReactions(CHANNEL, id(390), [reaction("👍", ["casey"])]);
    const after = logOf().rows.get(id(390));
    expect(shape(id(390))).toEqual([["👍", ["casey"]]]);
    expect(shape(id(391))).toEqual([]);
    expect(after).not.toBe(original);
    expect(after?.seq).toBe(original?.seq);
    expect(original?.reactions).toEqual([]);
  });

  it("does nothing for a row or a channel that isn't held", () => {
    setReactions(CHANNEL, "gone", [reaction("👍", ["ada"])]);
    setReactions("elsewhere", id(390), [reaction("👍", ["ada"])]);
    expect(logOf().rows.has("gone")).toBe(false);
    expect(shape(id(390))).toEqual([]);
  });
});

describe("toggleReaction", () => {
  it("shows the toggle at once and the server's list after", async () => {
    const message = logOf().rows.get(id(390));
    if (!message) throw new Error("no row");
    toggle.mockResolvedValue({
      message: { ...message, reactions: [reaction("👍", ["bea", "ada"])] },
    });
    const toggling = toggleReaction(message, "👍", "ada");
    expect(shape(id(390))).toEqual([["👍", ["ada"]]]);
    await toggling;
    expect(shape(id(390))).toEqual([["👍", ["bea", "ada"]]]);
  });

  it("gives way to the event that follows, at a higher seq", async () => {
    const message = logOf().rows.get(id(390));
    if (!message) throw new Error("no row");
    toggle.mockResolvedValue({});
    await toggleReaction(message, "👍", "ada");
    // The server's reactions_changed carries the whole list at the row's
    // new position.
    postOnServer(id(390), { reactions: [reaction("👍", ["ada", "bea"])] });
    expect(shape(id(390))).toEqual([["👍", ["ada", "bea"]]]);
  });

  it("puts the list back when the server refuses", async () => {
    const message = logOf().rows.get(id(390));
    if (!message) throw new Error("no row");
    toggle.mockRejectedValue(new Error("no"));
    await toggleReaction(message, "👍", "ada");
    expect(shape(id(390))).toEqual([]);
  });
});

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import {
  dmFaces,
  dmIsGroup,
  dmOther,
  dmTitle,
  dmUnreadTotal,
  patchDirectMessage,
} from "./dms";

// This module reaches ./clients, which builds its transport from
// location.origin at import time; the node environment has no location.
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = new URL(
    "http://localhost/",
  );
});

const author = (
  id: string,
  username: string,
  displayName = "",
): MessageAuthor => ({ id, username, displayName }) as MessageAuthor;

const channel = (id: string, lastMessageId = ""): Channel =>
  ({ id, lastMessageId, lastReadMessageId: "", unreadCount: 0 }) as Channel;

const unreadChannel = (id: string, unreadCount: number, muted = false) =>
  ({
    id,
    lastMessageId: "",
    lastReadMessageId: "",
    unreadCount,
    muted,
  }) as Channel;

const dm = (c: Channel, participants: MessageAuthor[] = []): DirectMessage =>
  ({ channel: c, participants }) as unknown as DirectMessage;

// More than two people is a group; membership never changes, so the count
// is the whole test.
const groupDm = dm;

const casey = author("u1", "casey", "Casey");
const ada = author("u2", "ada", "Ada W.");
const bea = author("u3", "bea");

describe("dmOther", () => {
  it("is the participant who isn't me", () => {
    expect(dmOther(dm(channel("d1"), [casey, ada]), "u1")).toBe(ada);
    expect(dmOther(dm(channel("d1"), [ada, casey]), "u1")).toBe(ada);
  });

  // A note to self has only me in it; showing my own name beats showing
  // nothing.
  it("falls back to me when I am the only participant", () => {
    expect(dmOther(dm(channel("d1"), [casey]), "u1")).toBe(casey);
  });

  it("takes the first participant when I am not known yet", () => {
    expect(dmOther(dm(channel("d1"), [casey, ada]), undefined)).toBe(casey);
  });

  it("is undefined when there are no participants", () => {
    expect(dmOther(dm(channel("d1")), "u1")).toBeUndefined();
  });
});

describe("dmTitle", () => {
  it("prefers the other person's display name", () => {
    expect(dmTitle(dm(channel("d1"), [casey, ada]), "u1")).toBe("Ada W.");
  });

  it("falls back to their username", () => {
    expect(dmTitle(dm(channel("d1"), [casey, bea]), "u1")).toBe("bea");
  });

  it("has a placeholder when there is nobody to name", () => {
    expect(dmTitle(dm(channel("d1")), "u1")).toBe("…");
  });
});

const dee = author("u4", "dee", "Dee");
const eli = author("u5", "eli", "Eli");

describe("dmTitle for a group", () => {
  const group = (...people: MessageAuthor[]) =>
    groupDm(channel("g1"), [casey, ...people]);

  it("names two people with an and", () => {
    expect(dmTitle(group(ada, bea), "u1")).toBe("Ada W. and bea");
  });

  it("names three", () => {
    expect(dmTitle(group(ada, bea, dee), "u1")).toBe("Ada W., bea and Dee");
  });

  it("counts the rest past three", () => {
    expect(dmTitle(group(ada, bea, dee, eli), "u1")).toBe(
      "Ada W., bea and 2 others",
    );
  });

  it("leaves a 1:1 alone", () => {
    expect(dmIsGroup(dm(channel("d1"), [casey, ada]))).toBe(false);
    expect(dmTitle(dm(channel("d1"), [casey, ada]), "u1")).toBe("Ada W.");
  });
});

describe("dmFaces", () => {
  it("is the other person in a 1:1", () => {
    expect(dmFaces(dm(channel("d1"), [casey, ada]), "u1")).toEqual([ada]);
  });

  it("is the first two others in a group", () => {
    expect(
      dmFaces(groupDm(channel("g1"), [casey, ada, bea, dee]), "u1"),
    ).toEqual([ada, bea]);
  });

  it("has nobody to show in an empty conversation", () => {
    expect(dmFaces(dm(channel("d1")), "u1")).toEqual([]);
  });
});

describe("patchDirectMessage", () => {
  const list = () => [
    dm(channel("ada", "05"), [casey, ada]),
    dm(channel("bea", "03"), [casey, bea]),
  ];

  it("patches only the named conversation", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], list());
    patchDirectMessage(qc, "ada", () => ({ unreadCount: 4 }));
    const dms = qc.getQueryData<DirectMessage[]>(["dms"]);
    expect(dms?.map((d) => d.channel?.unreadCount)).toEqual([4, 0]);
  });

  it("passes the current channel to the patch", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], list());
    patchDirectMessage(qc, "ada", (c) => ({
      lastReadMessageId: c.lastMessageId,
    }));
    expect(
      qc.getQueryData<DirectMessage[]>(["dms"])?.[0].channel?.lastReadMessageId,
    ).toBe("05");
  });

  it("keeps the rest of the channel record", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], list());
    patchDirectMessage(qc, "ada", () => ({ unreadCount: 1 }));
    expect(qc.getQueryData<DirectMessage[]>(["dms"])?.[0]).toMatchObject({
      channel: { id: "ada", lastMessageId: "05" },
      participants: [casey, ada],
    });
  });

  // Newest message first: a new message in the quieter conversation moves
  // it to the top, which is the order the server lists them in.
  it("re-sorts the list on the newest message", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], list());
    patchDirectMessage(qc, "bea", () => ({ lastMessageId: "09" }));
    expect(
      qc.getQueryData<DirectMessage[]>(["dms"])?.map((d) => d.channel?.id),
    ).toEqual(["bea", "ada"]);
  });

  it("sorts a conversation with no messages last", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], [dm(channel("cal")), ...list()]);
    patchDirectMessage(qc, "cal", () => ({ unreadCount: 0 }));
    expect(
      qc.getQueryData<DirectMessage[]>(["dms"])?.map((d) => d.channel?.id),
    ).toEqual(["ada", "bea", "cal"]);
  });

  it("leaves an unloaded list alone", () => {
    const qc = new QueryClient();
    patchDirectMessage(qc, "ada", () => ({ unreadCount: 1 }));
    expect(qc.getQueryData(["dms"])).toBeUndefined();
  });

  it("leaves a loaded list alone when the conversation isn't in it", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], list());
    patchDirectMessage(qc, "cal", () => ({ unreadCount: 9 }));
    expect(
      qc.getQueryData<DirectMessage[]>(["dms"])?.map((d) => d.channel?.id),
    ).toEqual(["ada", "bea"]);
  });
});

// The rail pill must equal the sum of the row badges: they used to count
// different things — conversations in the feed, messages on the row — and
// disagreed in plain sight.
describe("dmUnreadTotal", () => {
  it("adds up the messages, not the conversations", () => {
    expect(
      dmUnreadTotal([
        dm(unreadChannel("a", 4), [casey, ada]),
        dm(unreadChannel("b", 2), [casey, bea]),
      ]),
    ).toBe(6);
  });

  it("skips a muted conversation, as its row skips the badge", () => {
    expect(
      dmUnreadTotal([
        dm(unreadChannel("a", 4), [casey, ada]),
        dm(unreadChannel("b", 9, true), [casey, bea]),
      ]),
    ).toBe(4);
  });

  it("is zero with nothing unread, and with nothing loaded", () => {
    expect(dmUnreadTotal([dm(unreadChannel("a", 0), [casey, ada])])).toBe(0);
    expect(dmUnreadTotal(undefined)).toBe(0);
  });
});

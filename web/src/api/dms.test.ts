import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { patchDirectMessage } from "./dms";

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

const dm = (c: Channel, participants: MessageAuthor[] = []): DirectMessage =>
  ({ channel: c, participants }) as unknown as DirectMessage;

const casey = author("u1", "casey", "Casey");
const ada = author("u2", "ada", "Ada W.");
const bea = author("u3", "bea");

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

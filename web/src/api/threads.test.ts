import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Message, ThreadSummary } from "../gen/stoop/chat/v1/message_pb";
import {
  applyThreadChanged,
  applyThreadMuted,
  applyThreadRead,
} from "./threads";

// The RPC client reads the page's origin; these tests never call it.
vi.mock("./clients", () => ({ chatClient: {} }));

const ME = "me";

const summary = (over: Partial<ThreadSummary> = {}): ThreadSummary =>
  ({
    replyCount: 1,
    recentAuthors: [{ id: "bea" }],
    participating: false,
    muted: false,
    unreadCount: 0,
    ...over,
  }) as ThreadSummary;

const root = (over: Partial<Message> = {}): Message =>
  ({
    id: "root",
    author: { id: "ada" },
    mentionUserIds: [],
    mentionsEveryone: false,
    mentionsHere: false,
    ...over,
  }) as Message;

function setup(rootMessage: Message) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], { user: { id: ME } });
  queryClient.setQueryData(["messages", "general"], [rootMessage]);
  const read = () =>
    queryClient.getQueryData<Message[]>(["messages", "general"])?.[0]?.thread;
  const change = (next: Partial<ThreadSummary>) =>
    applyThreadChanged(queryClient, "general", "root", summary(next));
  return { queryClient, read, change };
}

describe("applyThreadChanged", () => {
  it("counts a first reply on my own message", () => {
    const { read, change } = setup(
      root({ author: { id: ME } } as Partial<Message>),
    );
    change({ replyCount: 1 });
    expect(read()).toMatchObject({ participating: true, unreadCount: 1 });
  });

  it("counts a first reply where I was named, not where @everyone was", () => {
    const named = setup(root({ mentionUserIds: [ME] }));
    named.change({ replyCount: 1 });
    expect(named.read()?.unreadCount).toBe(1);
    const everyone = setup(
      root({ mentionUserIds: [ME], mentionsEveryone: true }),
    );
    everyone.change({ replyCount: 1 });
    expect(everyone.read()).toMatchObject({
      participating: false,
      unreadCount: 0,
    });
  });

  it("adds others' replies, not mine, and keeps my half", () => {
    const { read, change } = setup(
      root({ thread: summary({ participating: true, unreadCount: 1 }) }),
    );
    change({ replyCount: 3 });
    expect(read()).toMatchObject({ participating: true, unreadCount: 3 });
    change({
      replyCount: 4,
      recentAuthors: [{ id: ME }],
    } as Partial<ThreadSummary>);
    expect(read()?.unreadCount).toBe(3);
  });

  it("joins me to the thread when I reply", () => {
    const { read, change } = setup(root({ thread: summary() }));
    change({
      replyCount: 2,
      recentAuthors: [{ id: ME }],
    } as Partial<ThreadSummary>);
    expect(read()).toMatchObject({ participating: true, unreadCount: 0 });
  });

  it("counts nothing in a muted thread or one I'm not in", () => {
    const muted = setup(
      root({ thread: summary({ participating: true, muted: true }) }),
    );
    muted.change({ replyCount: 2 });
    expect(muted.read()).toMatchObject({ muted: true, unreadCount: 0 });
    const outside = setup(root({ thread: summary() }));
    outside.change({ replyCount: 2 });
    expect(outside.read()?.unreadCount).toBe(0);
  });

  it("never counts more than the replies left after a delete", () => {
    const { read, change } = setup(
      root({
        thread: summary({ replyCount: 3, participating: true, unreadCount: 3 }),
      }),
    );
    change({ replyCount: 1 });
    expect(read()?.unreadCount).toBe(1);
  });
});

describe("mute and read", () => {
  it("a mute clears the count, a read clears it too", () => {
    const { queryClient, read } = setup(
      root({ thread: summary({ participating: true, unreadCount: 2 }) }),
    );
    applyThreadRead(queryClient, "general", "root");
    expect(read()?.unreadCount).toBe(0);
    applyThreadMuted(queryClient, "general", "root", true);
    expect(read()?.muted).toBe(true);
  });
});

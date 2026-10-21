import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Message,
  MessageAuthorSchema,
  type ThreadSummary,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import { openChannel } from "./channelLog";
import {
  CHANNEL,
  id,
  logOf,
  resetServer,
  server,
} from "./channelLogTestServer";
import {
  applyThreadChanged,
  applyThreadMuted,
  applyThreadRead,
  noteMentionInThread,
} from "./threads";

const { listMessages, listChanges } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listChanges: vi.fn(),
}));
vi.mock("./clients", () => ({ chatClient: { listMessages, listChanges } }));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

const ME = "me";
const ROOT = id(390);

type SummaryInit = MessageInitShape<typeof ThreadSummarySchema>;

const summary = (over: SummaryInit = {}): ThreadSummary =>
  create(ThreadSummarySchema, {
    replyCount: 1,
    recentAuthors: [{ id: "bea" }],
    participating: false,
    muted: false,
    unreadCount: 0,
    ...over,
  });

beforeEach(() => resetServer(listMessages, listChanges));

// The channel opened with its root as the server holds it; the root's
// summary and mentions are the test's.
async function setup(over: Partial<Message> = {}) {
  // Each setup is its own server: a test that sets up twice must not see
  // the first run's root, held at a higher seq, win over the second's.
  resetServer(listMessages, listChanges);
  const held = server.rows.find((row) => row.id === ROOT) as Message;
  server.rows = server.rows.map((row) =>
    row.id === ROOT ? { ...held, ...over } : row,
  );
  await openChannel(CHANNEL);
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], { user: { id: ME } });
  const read = () => logOf().rows.get(ROOT)?.thread;
  // A ThreadChanged at the channel's next seq, as the server stamps it.
  const change = (next: SummaryInit) => {
    server.seq += 1;
    const thread = summary(next);
    applyThreadChanged(
      queryClient,
      create(ServerEventSchema, {
        payload: {
          case: "threadChanged",
          value: {
            channelId: CHANNEL,
            rootMessageId: ROOT,
            thread,
            seq: BigInt(server.seq),
          },
        },
      }),
      {
        channelId: CHANNEL,
        rootMessageId: ROOT,
        thread,
        seq: BigInt(server.seq),
      } as never,
    );
  };
  return { queryClient, read, change };
}

const me = create(MessageAuthorSchema, { id: ME });

describe("applyThreadChanged", () => {
  it("counts a first reply on my own message", async () => {
    const { read, change } = await setup({ author: me });
    change({ replyCount: 1 });
    expect(read()).toMatchObject({ participating: true, unreadCount: 1 });
  });

  it("counts a first reply where I was named, not where @channel was", async () => {
    const named = await setup({ mentionUserIds: [ME] });
    named.change({ replyCount: 1 });
    expect(named.read()?.unreadCount).toBe(1);
    const everyone = await setup({
      mentionUserIds: [ME],
      mentionsEntireChannel: true,
    });
    everyone.change({ replyCount: 1 });
    expect(everyone.read()).toMatchObject({
      participating: false,
      unreadCount: 0,
    });
  });

  it("adds others' replies, not mine, and keeps my half", async () => {
    const { read, change } = await setup({
      thread: summary({ participating: true, unreadCount: 1 }),
    });
    change({ replyCount: 3 });
    expect(read()).toMatchObject({ participating: true, unreadCount: 3 });
    change({ replyCount: 4, recentAuthors: [me] });
    expect(read()?.unreadCount).toBe(3);
  });

  it("counts me in when a reply names me, not when it says @here", async () => {
    const named = await setup({ thread: summary() });
    noteMentionInThread(named.queryClient, {
      threadRootId: ROOT,
      mentionUserIds: [ME],
      mentionsEntireChannel: false,
      mentionsHere: false,
    } as unknown as Message);
    named.change({ replyCount: 2 });
    expect(named.read()).toMatchObject({ participating: true, unreadCount: 1 });
    const here = await setup({ thread: summary() });
    noteMentionInThread(here.queryClient, {
      threadRootId: ROOT,
      mentionUserIds: [ME],
      mentionsEntireChannel: false,
      mentionsHere: true,
    } as unknown as Message);
    here.change({ replyCount: 2 });
    expect(here.read()?.participating).toBe(false);
  });

  it("joins me to the thread when I reply", async () => {
    const { read, change } = await setup({ thread: summary() });
    change({ replyCount: 2, recentAuthors: [me] });
    expect(read()).toMatchObject({ participating: true, unreadCount: 0 });
  });

  it("counts nothing in a muted thread or one I'm not in", async () => {
    const muted = await setup({
      thread: summary({ participating: true, muted: true }),
    });
    muted.change({ replyCount: 2 });
    expect(muted.read()).toMatchObject({ muted: true, unreadCount: 0 });
    const outside = await setup({ thread: summary() });
    outside.change({ replyCount: 2 });
    expect(outside.read()?.unreadCount).toBe(0);
  });

  it("never counts more than the replies left after a delete", async () => {
    const { read, change } = await setup({
      thread: summary({ replyCount: 3, participating: true, unreadCount: 3 }),
    });
    change({ replyCount: 1 });
    expect(read()?.unreadCount).toBe(1);
  });

  it("counts an event the log already knows only once", async () => {
    const { read, change } = await setup({
      thread: summary({ participating: true, unreadCount: 0 }),
    });
    change({ replyCount: 2 });
    expect(read()?.unreadCount).toBe(1);
    // The same change again, at the seq the log holds: stale.
    server.seq -= 1;
    change({ replyCount: 2 });
    expect(read()?.unreadCount).toBe(1);
  });
});

describe("mute and read", () => {
  it("a mute clears the count, a read clears it too", async () => {
    const { queryClient, read } = await setup({
      thread: summary({ participating: true, unreadCount: 2 }),
    });
    applyThreadRead(CHANNEL, ROOT);
    expect(read()?.unreadCount).toBe(0);
    applyThreadMuted(queryClient, CHANNEL, ROOT, true);
    expect(read()?.muted).toBe(true);
  });
});

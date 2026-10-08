import type { QueryClient } from "@tanstack/react-query";
import type { GetMeResponse } from "../gen/stoop/auth/v1/auth_pb";
import type { Message, ThreadSummary } from "../gen/stoop/chat/v1/message_pb";
import { useSidePanelStore } from "../stores/sidePanel";
import { chatClient } from "./clients";

// A thread's summary as this person sees it: the shared half comes from
// ThreadChanged, and participating, muted and unreadCount are theirs,
// filled by ListMessages and kept here. docs/architecture/web.md →
// Threads.

function patchSummary(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  patch: (summary: ThreadSummary) => ThreadSummary,
) {
  queryClient.setQueriesData<Message[]>(
    { queryKey: ["messages", channelId] },
    (old) =>
      old?.map((m) =>
        m.id === rootId && m.thread ? { ...m, thread: patch(m.thread) } : m,
      ),
  );
}

function cachedRoot(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
): Message | undefined {
  let found: Message | undefined;
  for (const [, messages] of queryClient.getQueriesData<Message[]>({
    queryKey: ["messages", channelId],
  })) {
    const root = messages?.find((m) => m.id === rootId);
    if (root?.thread) return root;
    found ??= root;
  }
  return found;
}

// A new summary from ThreadChanged, keeping this person's half. A reply
// by someone else adds to the count of a thread they are in and haven't
// muted; reading it (MarkThreadRead → ThreadRead) clears it.
export function applyThreadChanged(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  next: ThreadSummary | undefined,
) {
  const root = cachedRoot(queryClient, channelId, rootId);
  const me = queryClient.getQueryData<GetMeResponse>(["me"])?.user?.id;
  // A first reply has no summary to carry: the root says whether we
  // started it or were named in it (@everyone and @here don't count).
  const previous =
    root?.thread ??
    (root && {
      replyCount: 0,
      participating:
        root.author?.id === me ||
        (!root.mentionsEveryone &&
          !root.mentionsHere &&
          !!me &&
          root.mentionUserIds.includes(me)),
      muted: false,
      unreadCount: 0,
    });
  let merged = next;
  if (next && previous) {
    const added = next.replyCount - previous.replyCount;
    const byMe = next.recentAuthors[0]?.id === me;
    const counts = previous.participating && !previous.muted;
    merged = {
      ...next,
      participating: previous.participating || (added > 0 && byMe),
      muted: previous.muted,
      unreadCount: Math.min(
        next.replyCount,
        previous.unreadCount + (counts && added > 0 && !byMe ? added : 0),
      ),
    };
  }
  queryClient.setQueriesData<Message[]>(
    { queryKey: ["messages", channelId] },
    (old) => old?.map((m) => (m.id === rootId ? { ...m, thread: merged } : m)),
  );
}

export function applyThreadMuted(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  muted: boolean,
) {
  patchSummary(queryClient, channelId, rootId, (s) => ({
    ...s,
    muted,
    unreadCount: muted ? 0 : s.unreadCount,
  }));
  queryClient.invalidateQueries({ queryKey: ["threadMutes"] });
  queryClient.invalidateQueries({ queryKey: ["activity"] });
}

export function applyThreadRead(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
) {
  patchSummary(queryClient, channelId, rootId, (s) => ({
    ...s,
    unreadCount: 0,
  }));
}

export async function setThreadMuted(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  muted: boolean,
) {
  await chatClient.setThreadMuted({ messageId: rootId, muted });
  applyThreadMuted(queryClient, channelId, rootId, muted);
}

export async function markThreadRead(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
) {
  await chatClient.markThreadRead({ messageId: rootId });
  applyThreadRead(queryClient, channelId, rootId);
}

// The thread the side panel shows, if any.
export function openThreadRootId(): string | undefined {
  const open = useSidePanelStore.getState().open;
  return open?.kind === "thread" ? open.params.rootId : undefined;
}

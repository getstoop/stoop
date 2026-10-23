import type { QueryClient } from "@tanstack/react-query";
import { namesMe, viewerHalfAfter } from "../core/threadUnread";
import type { GetMeResponse } from "../gen/stoop/auth/v1/auth_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type {
  ServerEvent,
  ThreadChanged,
} from "../gen/stoop/realtime/v1/realtime_pb";
import { useSidePanelStore } from "../stores/sidePanel";
import { applyEvent, patchThread, readRow } from "./channelLog";
import { chatClient } from "./clients";

// A thread's summary as this person sees it: the shared half comes from
// ThreadChanged, and participating, muted and unreadCount are theirs,
// filled by ListMessages and kept here, patched on the held root with no
// seq (channelLog patchThread). docs/architecture/messaging.md → Threads.

// Threads a new reply named this person in, by root: MessageCreated lands
// before its ThreadChanged, which then counts them in (the server counts
// a named mention as taking part; @channel and @here don't).
const namedIn = new Set<string>();

export function noteMentionInThread(
  queryClient: QueryClient,
  message: Message,
) {
  const me = queryClient.getQueryData<GetMeResponse>(["me"])?.user?.id;
  if (namesMe(message, me) && message.threadRootId) {
    namedIn.add(message.threadRootId);
  }
}

// A new summary from ThreadChanged: the log takes the shared half at the
// event's seq, keeping this person's half; then that half moves on. A
// reply by someone else adds to the count of a thread they are in and
// haven't muted; reading it (MarkThreadRead → ThreadRead) clears it. An
// event the log did not apply (stale, or the root not held) changes
// nothing, so a catch-up's copy of the root is never counted twice.
export function applyThreadChanged(
  queryClient: QueryClient,
  event: ServerEvent,
  change: ThreadChanged,
) {
  const { channelId, rootMessageId: rootId, thread: next } = change;
  const root = readRow(channelId, rootId);
  applyEvent(event);
  const after = readRow(channelId, rootId);
  const applied = !!root && !!after && after !== root;
  if (!applied || !next) {
    namedIn.delete(rootId);
    return;
  }
  const me = queryClient.getQueryData<GetMeResponse>(["me"])?.user?.id;
  const half = viewerHalfAfter(root, next, me, namedIn.has(rootId));
  namedIn.delete(rootId);
  patchThread(channelId, rootId, half);
}

export function applyThreadMuted(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
  muted: boolean,
) {
  patchThread(channelId, rootId, muted ? { muted, unreadCount: 0 } : { muted });
  queryClient.invalidateQueries({ queryKey: ["threadMutes"] });
  queryClient.invalidateQueries({ queryKey: ["activity"] });
}

export function applyThreadRead(channelId: string, rootId: string) {
  patchThread(channelId, rootId, { unreadCount: 0 });
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

export async function markThreadRead(channelId: string, rootId: string) {
  await chatClient.markThreadRead({ messageId: rootId });
  applyThreadRead(channelId, rootId);
}

// The thread the side panel shows, if any.
export function openThreadRootId(): string | undefined {
  const open = useSidePanelStore.getState().open;
  return open?.kind === "thread" ? open.params.rootId : undefined;
}

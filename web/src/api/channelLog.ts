import {
  channelOfEvent,
  inRange,
  isLive,
  isShown,
  jumped,
  opened,
  paged,
  reconnected as reconnectedLog,
  sendFailed as sendFailedLog,
  sendStarted as sendStartedLog,
  sendSucceeded as sendSucceededLog,
  showsInChannel,
  viewOf,
  withEvent,
} from "../core/channelLog";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import { catchUp } from "./channelLogCatchUp";
import {
  beganLoading,
  endedLoading,
  ensureLog,
  forgetLog,
  generationOf,
  logOf,
  setLanding,
  updateLog,
  useChannelLogStore,
  type ViewRef,
  viewKey,
} from "./channelLogStore";
import { chatClient } from "./clients";

// The loader for the channel logs (core/channelLog): the requests that
// fill a view, the events and reconnects that keep a log current, and the
// reader's own sends. Not yet wired: the app still runs api/history.ts.

export const HISTORY_PAGE = 50;

export { catchUp } from "./channelLogCatchUp";
export {
  landed,
  useChannelItems,
  useChannelLogStore,
  useThreadItems,
  useView,
  useViewStatus,
  type ViewRef,
  type ViewStatus,
} from "./channelLogStore";

// The listMessages request for a view, before its paging fields.
const scope = (view: ViewRef) => ({
  channelId: view.channelId,
  threadId: view.rootId ?? "",
});

export const openChannel = (channelId: string) => open({ channelId });
export const openThread = (channelId: string, rootId: string) =>
  open({ channelId, rootId });

// The newest page, as the view's range. A failure is the caller's to
// show; the log stays, empty, for a retry.
async function open(view: ViewRef): Promise<void> {
  const generation = generationOf(view);
  const res = await request(view, () =>
    chatClient.listMessages({ ...scope(view), limit: HISTORY_PAGE }),
  );
  settle(view, (log) => opened(log, { rootId: view.rootId, generation, res }));
}

export const loadOlder = (view: ViewRef) => loadPage(view, "older");
export const loadNewer = (view: ViewRef) => loadPage(view, "newer");

// One page per view per direction at a time.
const paging = new Set<string>();

// The page beyond one edge of the range; how many rows it brought, 0 when
// there was nothing to ask for, the request failed, or the range was
// replaced while it was out.
async function loadPage(
  view: ViewRef,
  direction: "older" | "newer",
): Promise<number> {
  const held = viewOf(ensureLog(view.channelId), view.rootId);
  if (!held) return 0;
  const from =
    direction === "older"
      ? held.hasOlder && held.oldestId
      : held.hasNewer && held.newestId;
  const key = `${viewKey(view)}:${direction}`;
  if (!from || paging.has(key)) return 0;
  paging.add(key);
  try {
    const res = await request(view, () =>
      chatClient.listMessages({
        ...scope(view),
        ...(direction === "older" ? { beforeId: from } : { afterId: from }),
        limit: HISTORY_PAGE,
      }),
    );
    const stale = generationOf(view) !== held.generation;
    updateLog(view.channelId, (log) =>
      paged(log, direction, {
        rootId: view.rootId,
        generation: held.generation,
        res,
      }),
    );
    return stale ? 0 : res.messages.length;
  } catch {
    return 0;
  } finally {
    paging.delete(key);
  }
}

// Lands the view on a message: where it is held and shown inside the
// range, without a request; otherwise a page around it replaces the
// range. found is false when it isn't in the timeline (deleted, or a
// bogus link). A reply that shows only in its thread centres a channel on
// its root and names the thread to open at the reply.
export async function jumpTo(
  view: ViewRef,
  messageId: string,
): Promise<{ found: boolean; threadRootId?: string }> {
  const log = ensureLog(view.channelId);
  const held = viewOf(log, view.rootId);
  const row = log.rows.get(messageId);
  // A thread's root is not one of its replies: it shows with the first
  // page, which has nothing older.
  const atRoot = !!view.rootId && messageId === view.rootId;
  const shown =
    !!held &&
    !!row &&
    isShown(row) &&
    (atRoot
      ? !held.hasOlder
      : inRange(held, messageId) &&
        (view.rootId ? row.threadRootId === view.rootId : showsInChannel(row)));
  if (shown) {
    setLanding(view, { id: messageId });
    return { found: true };
  }
  const generation = held?.generation ?? 0;
  let res: ListMessagesResponse;
  try {
    res = await request(view, () =>
      chatClient.listMessages({
        ...scope(view),
        ...(atRoot ? { afterId: messageId } : { aroundId: messageId }),
        limit: HISTORY_PAGE,
      }),
    );
  } catch {
    return { found: false };
  }
  if (atRoot) res = { ...res, hasOlder: false };
  // A later jump replaced the range meanwhile: this one is not where the
  // reader is going.
  if (generationOf(view) !== generation) return { found: false };
  settle(view, (log) => jumped(log, { rootId: view.rootId, generation, res }));
  const threadRootId = (!atRoot && res.threadRootId) || undefined;
  setLanding(view, { id: threadRootId ?? messageId });
  return { found: true, threadRootId };
}

// Replaces a view that stops short of the newest row with the newest page
// (the "Jump to latest" pill, a send from history).
export async function jumpToLatest(view: ViewRef): Promise<void> {
  const held = viewOf(ensureLog(view.channelId), view.rootId);
  if (held && isLive(held)) return;
  const generation = held?.generation ?? 0;
  const res = await request(view, () =>
    chatClient.listMessages({ ...scope(view), limit: HISTORY_PAGE }),
  );
  if (generationOf(view) !== generation) return;
  settle(view, (log) => jumped(log, { rootId: view.rootId, generation, res }));
  setLanding(view, "bottom");
}

// A realtime event about a message, to its channel's log when one is held;
// a gap it reveals starts the catch-up.
export function applyEvent(event: ServerEvent) {
  const channelId = channelOfEvent(event);
  if (!channelId || !logOf(channelId)) return;
  const after = updateLog(channelId, (log) => withEvent(log, event));
  if (after?.needsCatchUp) void catchUp(channelId);
}

// The socket is back: every log owes a catch-up from where it stands.
export function reconnected() {
  for (const channelId of Object.keys(useChannelLogStore.getState().logs)) {
    updateLog(channelId, reconnectedLog);
    void catchUp(channelId);
  }
}

// The UI no longer shows the channel: its log goes.
export function forget(channelId: string) {
  forgetLog(channelId);
  for (const key of [...paging]) {
    if (key === channelId || key.startsWith(`${channelId}/`))
      paging.delete(key);
  }
}

// The reader's send, shown at the bottom of the view until the server
// answers. The draft carries a client-made id and the reader as author;
// the view names its channel and thread.
export function sendStarted(view: ViewRef, draft: Message) {
  ensureLog(view.channelId);
  updateLog(view.channelId, (log) =>
    sendStartedLog(log, {
      ...draft,
      channelId: view.channelId,
      threadRootId: view.rootId ?? draft.threadRootId,
    }),
  );
}

export function sendSucceeded(
  channelId: string,
  draftId: string,
  row: Message,
) {
  updateLog(channelId, (log) => sendSucceededLog(log, draftId, row));
}

export function sendFailed(channelId: string, draftId: string) {
  updateLog(channelId, (log) => sendFailedLog(log, draftId));
}

// A request for a view, counted as loading while out.
async function request<T>(view: ViewRef, send: () => Promise<T>): Promise<T> {
  beganLoading(view);
  try {
    return await send();
  } finally {
    endedLoading(view);
  }
}

// A page's answer into the log; a catch-up owed by then (a reconnect
// while the page was out) starts.
function settle(view: ViewRef, change: Parameters<typeof updateLog>[1]) {
  const after = updateLog(view.channelId, change);
  if (after?.needsCatchUp) void catchUp(view.channelId);
}

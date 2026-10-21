import {
  channelOfEvent,
  forgetItems,
  inRange,
  isShown,
  jumped,
  opened,
  paged,
  reconnected as reconnectedLog,
  showsInChannel,
  type ThreadOverlay,
  viewOf,
  withEvent,
  withThreadOverlay,
} from "../core/channelLog";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import { catchUp } from "./channelLogCatchUp";
import {
  beganLoading,
  endedLoading,
  ensureLog,
  epochOf,
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
// fill a view, and the events and reconnects that keep a log current. Not
// yet wired: the app still runs api/history.ts.

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

// The newest page, as the view's range. The log starts empty before the
// request, so events about the channel have somewhere to go meanwhile. A
// failure is the caller's to show; the log stays for a retry.
async function open(view: ViewRef): Promise<void> {
  ensureLog(view.channelId);
  const generation = generationOf(view);
  const res = await request(view, () =>
    chatClient.listMessages({ ...scope(view), limit: HISTORY_PAGE }),
  );
  if (!res) return;
  settle(view, (log) => opened(log, { rootId: view.rootId, generation, res }));
}

export const loadOlder = (view: ViewRef) => loadPage(view, "older");
export const loadNewer = (view: ViewRef) => loadPage(view, "newer");

type Direction = "older" | "newer";

// The directions a page is out in, by view.
const paging = new Map<string, Set<Direction>>();

// The page beyond one edge of the range; how many rows it brought, 0 when
// there was nothing to ask for, the request failed, or the range was
// replaced while it was out. One page per view per direction at a time.
async function loadPage(view: ViewRef, direction: Direction): Promise<number> {
  const log = logOf(view.channelId);
  const held = log && viewOf(log, view.rootId);
  if (!held) return 0;
  const from =
    direction === "older"
      ? held.hasOlder && held.oldestId
      : held.hasNewer && held.newestId;
  const key = viewKey(view);
  const out = paging.get(key) ?? new Set<Direction>();
  if (!from || out.has(direction)) return 0;
  out.add(direction);
  paging.set(key, out);
  try {
    const res = await request(view, () =>
      chatClient.listMessages({
        ...scope(view),
        ...(direction === "older" ? { beforeId: from } : { afterId: from }),
        limit: HISTORY_PAGE,
      }),
    );
    if (!res) return 0;
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
    out.delete(direction);
    if (paging.get(key) === out && out.size === 0) paging.delete(key);
  }
}

// Lands the view on a message: where it is held and shown inside the
// range, without a request; otherwise a page around it replaces the
// range (and opens the channel, for a deep link). found is false when it
// isn't in the timeline (deleted, or a bogus link). A reply that shows
// only in its thread centres a channel on its root and names the thread
// to open at the reply.
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
  let res: ListMessagesResponse | undefined;
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
  // Forgotten meanwhile, or a later jump replaced the range: this one is
  // not where the reader is going.
  if (!res || generationOf(view) !== generation) return { found: false };
  if (atRoot) res = { ...res, hasOlder: false };
  const page = res;
  settle(view, (log) =>
    jumped(log, { rootId: view.rootId, generation, res: page }),
  );
  const threadRootId = (!atRoot && res.threadRootId) || undefined;
  setLanding(view, { id: threadRootId ?? messageId });
  return { found: true, threadRootId };
}

// Replaces a view that stops short of the newest row with the newest page
// (the "Jump to latest" pill, a send from history).
export async function jumpToLatest(view: ViewRef): Promise<void> {
  const log = logOf(view.channelId);
  const held = log && viewOf(log, view.rootId);
  if (!held?.hasNewer) return;
  const generation = held.generation;
  const res = await request(view, () =>
    chatClient.listMessages({ ...scope(view), limit: HISTORY_PAGE }),
  );
  if (!res || generationOf(view) !== generation) return;
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

// The reader's half of a root's thread summary, from their own read and
// mute events (api/threads.ts): no seq, patched on the held copy.
export function patchThread(
  channelId: string,
  rootId: string,
  patch: ThreadOverlay,
) {
  updateLog(channelId, (log) => withThreadOverlay(log, rootId, patch));
}

// The socket is back: every log owes a catch-up from where it stands.
export function reconnected() {
  for (const channelId of Object.keys(useChannelLogStore.getState().logs)) {
    updateLog(channelId, reconnectedLog);
    void catchUp(channelId);
  }
}

// The UI no longer shows the channel: its log goes, and a page still out
// for it answers to nobody.
export function forget(channelId: string) {
  forgetLog(channelId);
  forgetItems(channelId);
  for (const key of [...paging.keys()]) {
    if (key === channelId || key.startsWith(`${channelId}/`))
      paging.delete(key);
  }
}

// A request for a view, counted as loading while out; undefined when the
// channel was forgotten meanwhile, its answer being nobody's.
async function request<T>(
  view: ViewRef,
  send: () => Promise<T>,
): Promise<T | undefined> {
  const epoch = epochOf(view.channelId);
  beganLoading(view);
  try {
    const res = await send();
    return epochOf(view.channelId) === epoch ? res : undefined;
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

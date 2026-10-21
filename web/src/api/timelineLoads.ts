import type { QueryClient } from "@tanstack/react-query";
import { newerAfter, olderBefore } from "../core/timelineState";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { chatClient } from "./clients";
import {
  HISTORY_PAGE,
  isLive,
  pageOf,
  setWhere,
  step,
  type Timeline,
  timelineId,
  timelineKey,
  useHistoryStore,
  WINDOW_CAP,
  wasOut,
  windowOf,
} from "./history";

// The requests that fill a timeline's window (api/history.ts): its first
// load and refreshes (the messages query's queryFn), a page either side,
// and the jumps that replace it. Each starts under an id of its own and
// hands its answer, or its failure, to the reducer.

let lastRequest = 0;

// The listMessages request for a timeline, before its paging fields.
const scope = (t: Timeline) => ({
  channelId: t.channelId,
  threadId: t.rootId ?? "",
});

const loadedAction = (t: Timeline, id: number, res: ListMessagesResponse) => ({
  type: "loaded" as const,
  id,
  channelId: t.channelId,
  rootId: t.rootId,
  page: pageOf(res),
  header: undefined,
  newAfter: null,
});

// The server's largest page, for fetchLiveWindow's catch-up.
const SPAN_PAGE = 100;

// The newest rows back to `have`'s oldest, for refetching a live window
// (a rename, Ready): the rows redraw from the server and the history the
// reader paged in stays.
export async function fetchLiveWindow(
  t: Timeline,
  have: Message[],
): Promise<ListMessagesResponse> {
  const oldestId = have[0]?.id;
  const bound = Math.max(have.length, WINDOW_CAP);
  const newest = await chatClient.listMessages({
    ...scope(t),
    limit: SPAN_PAGE,
  });
  let rows = newest.messages;
  let hasOlder = newest.hasOlder;
  const reached = () => rows.some((m) => m.id === oldestId);
  while (hasOlder && rows.length > 0 && rows.length < bound && !reached()) {
    const older = await chatClient.listMessages({
      ...scope(t),
      beforeId: rows[0].id,
      limit: SPAN_PAGE,
    });
    rows = [...older.messages, ...rows];
    hasOlder = older.hasOlder;
  }
  const start = rows.findIndex((m) => m.id === oldestId);
  if (start > 0) {
    rows = rows.slice(start);
    hasOlder = true;
  }
  return { ...newest, messages: rows, hasOlder };
}

// The messages query's fetch. A refetch (an event, Ready) must not yank a
// reader who jumped into history back to the newest page, so a window
// that isn't live stays as it is; a live one is fetched again over the
// rows it spans. A first load opens around aroundId when given (a deep
// link), or on the newest page when that message isn't in the timeline.
export async function loadWindow(
  queryClient: QueryClient,
  t: Timeline,
  aroundId?: string,
): Promise<Message[]> {
  const have = queryClient.getQueryData<Message[]>(timelineKey(t));
  if (
    have?.length &&
    !isLive(useHistoryStore.getState().channels[timelineId(t)])
  )
    return have;
  const id = ++lastRequest;
  const kind = have ? "refresh" : "open";
  const out = step(
    queryClient,
    t,
    { type: "started", id, kind, channelId: t.channelId },
    false,
  );
  // A jump on its way will be fresher.
  if (!wasOut(out.after, id)) return have ?? [];
  let res: ListMessagesResponse | undefined;
  try {
    if (have?.length) {
      res = await fetchLiveWindow(t, have);
    } else if (aroundId) {
      res = await chatClient
        .listMessages({ ...scope(t), aroundId })
        .catch(() => undefined);
    }
    res ??= await chatClient.listMessages(scope(t));
  } catch (err) {
    step(queryClient, t, { type: "failed", id, outcome: "failed" }, false);
    throw err;
  }
  const { before, after } = step(
    queryClient,
    t,
    loadedAction(t, id, res),
    false,
  );
  if (after.shown.state !== "ready") return have ?? [];
  // A fresh window: where to land and which thread it names start over.
  if (wasOut(before, id))
    setWhere(t, {
      landOn: undefined,
      aroundThread: res.threadRootId || undefined,
    });
  return after.shown.page.messages;
}

// Prepends the page before the window's oldest message; the number of
// messages it brought.
export function loadOlder(queryClient: QueryClient, t: Timeline) {
  return loadPage(queryClient, t, "older");
}

// Appends the page after the window's newest message.
export function loadNewer(queryClient: QueryClient, t: Timeline) {
  return loadPage(queryClient, t, "newer");
}

async function loadPage(
  queryClient: QueryClient,
  t: Timeline,
  kind: "older" | "newer",
): Promise<number> {
  const held = windowOf(queryClient, t);
  const from = kind === "older" ? olderBefore(held) : newerAfter(held);
  if (!from) return 0;
  const id = ++lastRequest;
  step(queryClient, t, { type: "started", id, kind });
  let res: ListMessagesResponse;
  try {
    res = await chatClient.listMessages({
      ...scope(t),
      ...(kind === "older" ? { beforeId: from } : { afterId: from }),
      limit: HISTORY_PAGE,
    });
  } catch {
    step(queryClient, t, { type: "failed", id, outcome: "failed" });
    return 0;
  }
  const { before } = step(queryClient, t, {
    type: "paged",
    id,
    page: pageOf(res),
    cap: WINDOW_CAP,
  });
  // Dropped for a reconnect while it was out: ask again from what is held
  // now, since the reader is still at that edge.
  const request = before.requests.find((out) => out.id === id);
  if (request && request.since !== before.reconnects)
    return loadPage(queryClient, t, kind);
  return request ? res.messages.length : 0;
}

// Replaces the window with one centred on messageId; found is false if
// it isn't in the timeline (deleted, or a bogus link). A reply that shows
// only in its thread centres a channel on its root instead and names the
// thread to open.
export async function jumpTo(
  queryClient: QueryClient,
  t: Timeline,
  messageId: string,
): Promise<{ found: boolean; threadRootId?: string }> {
  // A thread's root is not one of its replies: the window that shows it
  // is the first page, the replies after it, with nothing older.
  const atRoot = !!t.rootId && messageId === t.rootId;
  const res = await replaceWindow(queryClient, t, () =>
    chatClient
      .listMessages({
        ...scope(t),
        ...(atRoot ? { afterId: messageId } : { aroundId: messageId }),
        limit: HISTORY_PAGE,
      })
      .then((answer) => (atRoot ? { ...answer, hasOlder: false } : answer)),
  );
  if (!res) return { found: false };
  const threadRootId = (!atRoot && res.threadRootId) || undefined;
  // The caller opens the thread from the answer; nothing is left to take
  // later.
  setWhere(t, {
    landOn: { id: threadRootId ?? messageId },
    aroundThread: undefined,
  });
  return { found: true, threadRootId };
}

// Replaces a window that isn't live with the newest page.
export async function jumpToLatest(queryClient: QueryClient, t: Timeline) {
  if (isLive(useHistoryStore.getState().channels[timelineId(t)])) return;
  const res = await replaceWindow(queryClient, t, () =>
    chatClient.listMessages({ ...scope(t), limit: HISTORY_PAGE }),
  );
  if (res) setWhere(t, { landOn: "bottom" });
}

// A new window from fetch, or null when it failed or a later request put
// it out of date.
async function replaceWindow(
  queryClient: QueryClient,
  t: Timeline,
  fetch: () => Promise<ListMessagesResponse>,
): Promise<ListMessagesResponse | null> {
  const id = ++lastRequest;
  step(queryClient, t, {
    type: "started",
    id,
    kind: "open",
    channelId: t.channelId,
  });
  let res: ListMessagesResponse;
  try {
    res = await fetch();
  } catch {
    step(queryClient, t, { type: "failed", id, outcome: "failed" });
    return null;
  }
  const { before, after } = step(queryClient, t, loadedAction(t, id, res));
  if (!wasOut(before, id) || after.shown.state !== "ready") return null;
  return res;
}

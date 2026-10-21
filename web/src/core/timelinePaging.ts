import type { Page } from "./channelTimeline";
import { withChannelEvent } from "./channelTimeline";
import type { Header } from "./timelineEvents";
import type {
  Ready,
  Request,
  RequestKind,
  Shown,
  Timeline,
} from "./timelineState";

// Paging a timeline's window (timelineState): the page above what is held,
// and the page below it for a window that doesn't reach the newest
// message. One page is out at a time, and none while a new window is on
// its way. With a cap, paging one way drops the far end past it, and the
// window then has more beyond that end.

export type PageKind = "older" | "newer";

export function isPage(kind: RequestKind): kind is PageKind {
  return kind === "older" || kind === "newer";
}

// The id to page back from, or null when there is no older page to ask
// for: nothing above, or a request already on its way.
export function olderBefore<H extends Header>(
  state: Timeline<H>,
): string | null {
  const shown = idle(state);
  if (!shown?.page.hasOlder) return null;
  return shown.page.messages[0]?.id ?? null;
}

// The id to page forward from, or null when the window reaches the newest
// message or a request is on its way.
export function newerAfter<H extends Header>(
  state: Timeline<H>,
): string | null {
  const shown = idle(state);
  if (!shown?.page.hasNewer) return null;
  const { messages } = shown.page;
  return messages[messages.length - 1]?.id ?? null;
}

export function startedPage<H extends Header>(
  state: Timeline<H>,
  id: number,
  kind: PageKind,
): Timeline<H> {
  const shown = idle(state);
  const from = kind === "older" ? olderBefore(state) : newerAfter(state);
  if (!shown || from === null) return state;
  return {
    ...state,
    shown:
      kind === "older"
        ? { ...shown, loadingOlder: true }
        : { ...shown, loadingNewer: true },
    requests: [
      ...state.requests,
      { id, kind, since: state.reconnects, kept: [] },
    ],
  };
}

// A page's answer. What changed in it meanwhile is replayed over the page
// alone: the same events have already been applied to what is held. A
// message that arrived meanwhile is never an older page's, and is the
// newer page's only when that page reaches the newest message; before
// then it was counted (pendingNewer). The page goes beside whatever is
// held now.
export function pagedIn<H extends Header>(
  state: Timeline<H>,
  request: Request,
  page: Page,
  cap?: number,
): Timeline<H> {
  const rest = without(state, request);
  const { shown } = state;
  if (shown.state !== "ready") return rest;
  if (request.since !== state.reconnects)
    return { ...rest, shown: notPaging(shown) };
  const older = request.kind === "older";
  const changed = request.kept.reduce(
    (list, event) =>
      event.payload.case === "messageCreated" && (older || page.hasNewer)
        ? list
        : withChannelEvent(list, event, shown.channelId, shown.rootId),
    page.messages,
  );
  const held = shown.page.messages;
  const fresh = changed.filter(
    (message) => !held.some((cached) => cached.id === message.id),
  );
  let messages = older ? [...fresh, ...held] : [...held, ...fresh];
  let { hasOlder, hasNewer } = shown.page;
  if (older) hasOlder = page.hasOlder;
  else hasNewer = page.hasNewer;
  if (cap !== undefined && messages.length > cap) {
    if (older) {
      messages = messages.slice(0, cap);
      hasNewer = true;
    } else {
      messages = messages.slice(messages.length - cap);
      hasOlder = true;
    }
  }
  return {
    ...rest,
    shown: {
      ...shown,
      loadingOlder: false,
      loadingNewer: false,
      page: { messages, hasOlder, hasNewer },
      // Back at the newest message: everything counted is now shown.
      pendingNewer: hasNewer ? shown.pendingNewer : 0,
    },
  };
}

export function without<H extends Header>(
  state: Timeline<H>,
  request: Request,
): Timeline<H> {
  return {
    ...state,
    requests: state.requests.filter((out) => out !== request),
  };
}

export function notPaging<H extends Header>(shown: Shown<H>): Shown<H> {
  return shown.state === "ready"
    ? { ...shown, loadingOlder: false, loadingNewer: false }
    : shown;
}

// What is shown, when a page may be asked for: nothing out but loads that
// keep the window (a catch-up, a refresh).
function idle<H extends Header>(state: Timeline<H>): Ready<H> | null {
  const { shown } = state;
  if (shown.state !== "ready" || shown.loadingOlder || shown.loadingNewer)
    return null;
  if (state.requests.some((out) => out.kind === "open")) return null;
  return shown;
}

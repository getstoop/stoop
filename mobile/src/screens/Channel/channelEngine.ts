import { Code, ConnectError } from "@connectrpc/connect";
import type { UploadedFile } from "@stoop/core/attachments";
import { changesMentionNames } from "@stoop/core/channelHeader";
import {
  type ChannelLog,
  forgetItems,
  hasPage,
  inRange,
  isShown,
  LOG_CAP,
  nextSince,
  showsInChannel,
  threadItems,
  viewOf,
} from "@stoop/core/channelLog";
import { emptyScreen, type Outcome, type ScreenAction, screenReducer } from "@stoop/core/channelScreen";
import { toggledReactions } from "@stoop/core/reactions";
import type { ListMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { AppState } from "react-native";
import { type LocalFile, uploadAttachment } from "../../api/files";
import {
  ChannelGone,
  deleteMessage,
  dismissLinkPreview,
  editMessage,
  loadChanges,
  loadChannel,
  loadHeader,
  loadAround,
  loadNewer,
  loadOlder,
  loadPage,
  loadReplies,
  loadRoot,
  markThreadRead,
  PAGE,
  type SendTo,
  sendMessage,
  setThreadMuted,
  toggleReaction,
} from "../../api/messages";
import { sessionToken } from "../../api/servers";
import type { Subscribe } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";

// A channel's log while a screen shows it: the channel screen, and a
// thread screen pushed over it, share one, so a reply, an edit or a read
// lands once for both. Opened on the newest page, or on the page around
// a message the screen opens at (jumpTo), grown by a page as the reader
// scrolls up, and down again while the range stops short of the newest
// row (newer), replaced by the newest page on the way back (jumpToLatest),
// kept current by the realtime socket's events, and after a reconnect or
// a gap in the events caught up with ListChanges from the position it
// holds (never by fetching what is held again). A thread's view is
// opened on its newest replies while its screen holds it, and closed
// when that goes. The rules are the channel log's (core/channelLog) and
// the screen's state over it core/channelScreen's; this makes the
// requests and dispatches each answer. The log lives while any screen
// holds it and goes with the last (useChannelLog, useThread).

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15_000;

// Why a load failed, as the screen shows it.
function outcomeOf(err: unknown): Outcome {
  if (err instanceof ChannelGone) return "gone";
  if (err instanceof ConnectError && err.code === Code.Unauthenticated) return "ended";
  if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) return "gone";
  return "failed";
}

// A refusal that won't change, so a catch-up stops asking.
const final = (err: unknown) => err instanceof ConnectError && err.code === Code.InvalidArgument;

// A refusal for something not found: a send's NotFound may be its root's
// or its quote's, not the channel's.
const notFound = (err: unknown) => err instanceof ConnectError && err.code === Code.NotFound;

// A refusal that means the sign-in has ended. For a request about one
// message that is the only answer that says anything about the screen:
// NotFound is the message's, not the channel's, and PermissionDenied says
// what the reader may do to it.
const ended = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

// Whether another older page of replies fits in a thread's view. A view
// holds at most LOG_CAP rows and a page past that prunes the newest, the
// edge the thread screen keeps live with no way back yet, so a thread's
// history ends a page short of the cap and the screen says so. The
// channel pages on: past its cap the newest end goes, and the pill back
// to the latest message reloads it (jumpToLatest).
export const olderFits = (log: ChannelLog, rootId: string) => threadItems(log, rootId).length + PAGE <= LOG_CAP;

// Where a jump landed: on the message (or on its root, naming the thread
// to open on it, for a reply that shows only there), or not: missing
// (the server has no row for it in the channel), failed (the ask didn't
// reach the server), or superseded (a later jump, or a range replaced
// under it, took its place: nothing to say).
export type JumpResult = {
  outcome: "found" | "missing" | "failed" | "superseded";
  threadRootId?: string;
};
const SUPERSEDED: JumpResult = { outcome: "superseded" };

// A jump asked for before the channel's header: the first page is asked
// for around it instead, and the answer is this jump's.
type PendingJump = { id: string; resolve: (result: JumpResult) => void };

// What the requests out for the log answer to: one lifetime from the
// first screen holding it to the last letting go. A request reads the
// lifetime it was made under when it lands and dispatches nothing once
// that has ended, and a catch-up running for it stops at its next step.
// A send's answer is the one exception: the row went into the channel
// whatever screen is showing, so it is merged all the same.
type Lifetime = {
  ended: boolean;
  // The open whose answer is wanted. An earlier one still out (a Ready
  // opened again while it was out) is dropped whichever lands first,
  // its failure too.
  opens: number;
  // The catch-up running, which a later ask waits on rather than
  // starting another.
  catchingUp: Promise<void> | null;
  // Ends a catch-up's wait before a retry early, when the socket is back.
  wake: (() => void) | null;
  // The header being loaded again for who a mention may name, and whether
  // an event asked again while it was out, or before the first header.
  renaming: boolean;
  renameAgain: boolean;
  // How many events have changed the header, so a load they overtook is
  // made again rather than put over them.
  headerChanges: number;
  // A jump asked for before the header: the open out, or the next one (a
  // Ready opening again, a retry), asks for the page around it.
  focus: PendingJump | null;
  // The newest page is out for a jump back to the latest message.
  jumpingLatest: boolean;
};

const newLifetime = (): Lifetime => ({
  ended: false,
  opens: 0,
  catchingUp: null,
  wake: null,
  renaming: false,
  renameAgain: false,
  headerChanges: 0,
  focus: null,
  jumpingLatest: false,
});

export type ChannelEngine = ReturnType<typeof createEngine>;

// By server and channel: the log every screen showing that channel holds.
const engines = new Map<string, ChannelEngine>();

export const engineKey = (server: SavedServer, channelId: string) => `${server.id}/${channelId}`;

// The channel's engine as a screen first renders: the one a screen holds
// already, or a new one that nothing knows of until it is held.
export function channelEngine(
  server: SavedServer,
  spaceId: string,
  channelId: string,
  subscribe: Subscribe,
): ChannelEngine {
  const key = engineKey(server, channelId);
  return engines.get(key) ?? createEngine(key, server, spaceId, channelId, subscribe);
}

// The engine a mounted screen holds: the one held for the channel already,
// or this one, which starts and becomes it. Let go with the function
// returned; the last to let go ends it.
export function holdEngine(engine: ChannelEngine, rootId?: string) {
  const held = engines.get(engine.key) ?? engine;
  const release = held.hold();
  const close = rootId === undefined ? undefined : held.holdThread(rootId);
  return {
    engine: held,
    release: () => {
      close?.();
      release();
    },
  };
}

function createEngine(key: string, server: SavedServer, spaceId: string, channelId: string, subscribe: Subscribe) {
  let state = emptyScreen(channelId);
  const watchers = new Set<() => void>();
  let holders = 0;
  let life = newLifetime();
  let unlisten: (() => void) | null = null;
  // By root: how many screens show the thread, and its latest open.
  const threadHolders = new Map<string, number>();
  const threadOpens = new Map<string, number>();

  // The state's latest value is readable as soon as an action is
  // dispatched, not only after React renders it.
  const dispatch = (action: ScreenAction) => {
    const next = screenReducer(state, action);
    if (next === state) return;
    state = next;
    for (const watcher of watchers) watcher();
  };

  const token = async () => state.token || (await sessionToken(server.id).catch(() => null)) || "";

  const rest = (mine: Lifetime, ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        mine.wake = null;
        resolve();
      }
      mine.wake = done;
    });

  // ListChanges from the log's position, page after page while the server
  // has more, until the log owes nothing: one run at a time. A failure
  // leaves the catch-up owed and asks again after a growing wait, which
  // the socket's Ready cuts short. In the background the sockets are
  // closed (RealtimeProvider; "inactive", the app switcher or a system
  // sheet, keeps them), so the run ends and the Ready on coming back
  // starts another. A refusal that means the channel is gone or the
  // sign-in has ended shows as such.
  function catchUp(): Promise<void> {
    const mine = life;
    if (!mine.catchingUp) {
      mine.catchingUp = runCatchUp(mine).finally(() => {
        mine.catchingUp = null;
      });
    }
    return mine.catchingUp;
  }

  async function runCatchUp(mine: Lifetime) {
    let delay = RETRY_BASE_MS;
    for (;;) {
      // Before the channel's own page a thread's may have positioned
      // the log, so the session is looked up when the header has none.
      const session = await token();
      const { log } = state;
      if (mine.ended || !session || !log.needsCatchUp || !hasPage(log)) return;
      if (AppState.currentState === "background") return;
      try {
        let since = log.seq;
        for (;;) {
          const res = await loadChanges(server.origin, session, channelId, since);
          if (mine.ended) return;
          dispatch({ type: "caughtUp", res });
          if (!res.hasMore || res.messages.length === 0) break;
          since = nextSince(since, res);
        }
        delay = RETRY_BASE_MS;
      } catch (err) {
        if (mine.ended || final(err)) return;
        const outcome = outcomeOf(err);
        if (outcome !== "failed") {
          dispatch({ type: "failed", outcome });
          return;
        }
        await rest(mine, delay);
        delay = Math.min(delay * 2, RETRY_CAP_MS);
      }
    }
  }

  // The header and the first page: the newest, or the page around a jump
  // asked for before the header (the screen opened at a message), which
  // then lands on it, or on its root for a reply that shows only in its
  // thread; a message not in the channel lands the newest page at its
  // bottom. The latest open is the one whose answer is wanted: a Ready
  // while this one is out opens again, since this one may have read the
  // server before the socket was back, and then this answer is dropped
  // whether it lands before or after. The log is held from the start, so
  // events about the channel have somewhere to go meanwhile; the page's
  // position says whether one of them is still owed.
  async function open() {
    const mine = life;
    const attempt = ++mine.opens;
    const stale = () => mine.ended || mine.opens !== attempt;
    const token = await sessionToken(server.id).catch(() => null);
    if (stale()) return;
    if (!token) {
      dispatch({ type: "failed", outcome: "ended" });
      return;
    }
    const generation = state.log.channel.generation;
    const focus = mine.focus;
    try {
      const { header, page, found } = await loadChannel(server.origin, token, spaceId, channelId, focus?.id);
      if (stale()) return;
      const threadRootId = page.threadRootId || undefined;
      const landOn = focus ? (found ? { id: threadRootId ?? focus.id } : "bottom") : undefined;
      dispatch({ type: "opened", header, res: page, token, generation, landOn });
      if (state.log.needsCatchUp) void catchUp();
      if (mine.renameAgain) void reloadNames();
      // The jump this page was asked for; one asked for while it was out
      // is made now, the header being there.
      const pending = mine.focus;
      mine.focus = null;
      if (pending && pending === focus) pending.resolve({ outcome: found ? "found" : "missing", threadRootId });
      else if (pending) void jumpOnce(pending.id).then(pending.resolve);
    } catch (err) {
      if (!stale()) dispatch({ type: "failed", outcome: outcomeOf(err) });
    }
  }

  // The channel landed on a message, the header being there: on the row
  // where the range holds and shows it, with no request; otherwise the
  // page around it replaces the range (core/channelScreen `jumped`),
  // unless a later jump replaced it first. A message the server has no
  // row for in the channel is missing; a failure to ask is failed, and
  // one that means the sign-in has ended shows as such.
  async function jumpOnce(messageId: string): Promise<JumpResult> {
    const mine = life;
    const { log } = state;
    const row = log.rows.get(messageId);
    if (row && isShown(row) && showsInChannel(row) && inRange(log.channel, messageId)) {
      dispatch({ type: "land", landOn: { id: messageId } });
      return { outcome: "found" };
    }
    const generation = log.channel.generation;
    let res: ListMessagesResponse;
    try {
      res = await loadAround(server.origin, await token(), channelId, messageId, PAGE);
    } catch (err) {
      if (mine.ended) return SUPERSEDED;
      if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
      return { outcome: notFound(err) ? "missing" : "failed" };
    }
    if (mine.ended || state.log.channel.generation !== generation) return SUPERSEDED;
    const threadRootId = res.threadRootId || undefined;
    dispatch({ type: "jumped", res, generation, landOn: { id: threadRootId ?? messageId } });
    return { outcome: "found", threadRootId };
  }

  // After a reconnect the header's facts may have changed too (a rename,
  // a member count), and the channel may be gone. An event changing the
  // header while this was out may be newer than what it read, so then it
  // is asked for again.
  async function refreshHeader(): Promise<void> {
    const mine = life;
    const changes = mine.headerChanges;
    try {
      const header = await loadHeader(server.origin, state.token, spaceId, channelId);
      if (mine.ended) return;
      if (mine.headerChanges !== changes) return refreshHeader();
      dispatch({ type: "header", header });
    } catch (err) {
      const outcome = outcomeOf(err);
      if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
    }
  }

  // The header again for a change to who a mention may name: a burst of
  // events asks once more after the load out, never once each.
  async function reloadNames() {
    const mine = life;
    if (mine.renaming) {
      mine.renameAgain = true;
      return;
    }
    mine.renaming = true;
    do {
      mine.renameAgain = false;
      await refreshHeader();
    } while (mine.renameAgain && !mine.ended);
    mine.renaming = false;
  }

  // A send naming a root or a quote refused as not found: whether the
  // channel went is the header's to say, and with the channel still there,
  // a root the server no longer has (a retention sweep, say) is the
  // thread gone, not the channel. A failure to ask leaves both alone.
  async function confirmGone(mine: Lifetime, rootId: string) {
    await refreshHeader();
    if (mine.ended || state.outcome || !rootId || !threadHolders.has(rootId)) return;
    let gone: boolean;
    try {
      gone = !(await loadRoot(server.origin, await token(), channelId, rootId));
    } catch (err) {
      gone = notFound(err);
    }
    if (gone && !mine.ended && threadHolders.has(rootId)) dispatch({ type: "threadFailed", rootId, outcome: "gone" });
  }

  // A thread's newest replies, with its root when the log doesn't hold
  // it (a thread opened before the channel's page, or on a root beyond
  // it). The latest open per thread is the one whose answer is wanted,
  // and none once its screen has let go. A root the server has no row
  // for is the thread gone.
  async function openThread(rootId: string) {
    const mine = life;
    const attempt = (threadOpens.get(rootId) ?? 0) + 1;
    threadOpens.set(rootId, attempt);
    const stale = () => mine.ended || threadOpens.get(rootId) !== attempt || !threadHolders.has(rootId);
    dispatch({ type: "threadOpening", rootId });
    const epoch = state.threads[rootId]?.epoch ?? 0;
    const session = await token();
    if (stale()) return;
    if (!session) {
      dispatch({ type: "failed", outcome: "ended" });
      return;
    }
    const generation = viewOf(state.log, rootId)?.generation ?? 0;
    const held = state.log.rows.has(rootId);
    try {
      const [res, fetched] = await Promise.all([
        loadReplies(server.origin, session, channelId, rootId),
        held ? undefined : loadRoot(server.origin, session, channelId, rootId),
      ]);
      if (stale()) return;
      // A held root the log let go of meanwhile (pruned at its cap) is
      // asked for after all.
      const root =
        held && !state.log.rows.has(rootId) ? await loadRoot(server.origin, session, channelId, rootId) : fetched;
      if (stale()) return;
      if (!root && !state.log.rows.has(rootId)) {
        dispatch({ type: "threadFailed", rootId, outcome: "gone" });
        return;
      }
      dispatch({ type: "threadOpened", rootId, epoch, res, generation, root });
      if (state.log.needsCatchUp) void catchUp();
    } catch (err) {
      if (stale()) return;
      const outcome = outcomeOf(err);
      if (outcome === "ended") dispatch({ type: "failed", outcome });
      else dispatch({ type: "threadFailed", rootId, outcome });
    }
  }

  function onEvent(event: ServerEvent) {
    if (event.payload.case !== "ready") {
      const before = state.header;
      dispatch({ type: "event", event });
      if (before && state.header !== before) life.headerChanges++;
      if (state.log.needsCatchUp) void catchUp();
      // A new role for the reader says nothing about what it permits; the
      // header fetched again carries the space's my_permissions.
      const { header } = state;
      if (
        event.payload.case === "memberRoleChanged" &&
        header &&
        event.payload.value.spaceId === header.space.id &&
        event.payload.value.userId === header.myUserId
      )
        void refreshHeader();
      else if (!state.outcome && changesMentionNames(event, spaceId, channelId, header?.channel.private ?? true)) {
        // Before the first header, the open out may have read the server
        // before this; it asks again once it lands.
        if (header) void reloadNames();
        else life.renameAgain = true;
      }
      return;
    }
    // The socket is back. A channel or a thread not yet open is opened
    // again, since a load still out may have read the server before the
    // socket was. Once any page has positioned the log it owes a catch-up
    // from where it stands (a catch-up waiting to retry goes now), and
    // after it each view's newest page is asked for again, for what
    // changed elsewhere with no seq: a thread read or muted.
    const { header, outcome } = state;
    if (outcome === "ended" || outcome === "gone") return;
    for (const rootId of threadHolders.keys()) {
      const gone = state.threads[rootId]?.outcome === "gone";
      if (!gone && !viewOf(state.log, rootId)?.generation) void openThread(rootId);
    }
    if (hasPage(state.log)) {
      const mine = life;
      dispatch({ type: "reconnected" });
      mine.wake?.();
      void catchUp().then(() => refreshViews(mine));
    }
    if (!header) {
      void open();
      return;
    }
    void refreshHeader();
  }

  // The newest page of each view that has one, and each open thread's
  // root, merged with the range and the position left alone (as web's
  // refreshViews). A failure is left to the next reconnect.
  async function refreshViews(mine: Lifetime) {
    const session = await token();
    if (mine.ended || !session) return;
    const pages: Promise<ListMessagesResponse>[] = [];
    if (state.log.channel.generation > 0) pages.push(loadPage(server.origin, session, channelId));
    for (const [rootId, view] of Object.entries(state.log.threads)) {
      if (view.generation === 0) continue;
      pages.push(
        loadReplies(server.origin, session, channelId, rootId),
        loadAround(server.origin, session, channelId, rootId),
      );
    }
    await Promise.all(
      pages.map((page) =>
        page.then(
          (res) => {
            if (!mine.ended) dispatch({ type: "refreshed", res });
          },
          () => {},
        ),
      ),
    );
  }

  function start() {
    if (!engines.has(key)) engines.set(key, self);
    state = emptyScreen(channelId);
    for (const watcher of watchers) watcher();
    life = newLifetime();
    unlisten = subscribe(server.id, onEvent);
    void open();
  }

  function stop() {
    life.ended = true;
    life.wake?.();
    life.focus?.resolve(SUPERSEDED);
    life.focus = null;
    unlisten?.();
    unlisten = null;
    threadHolders.clear();
    forgetItems(channelId);
    if (engines.get(key) === self) engines.delete(key);
  }

  const self = {
    key,
    current: () => state,
    subscribe(watcher: () => void) {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },

    // A screen showing the channel, until the function returned is
    // called. The first starts the log; the last ends it.
    hold() {
      holders++;
      if (holders === 1) start();
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        holders--;
        if (holders === 0) stop();
      };
    },

    // A screen showing a thread, held the same way, inside a hold of the
    // channel: the first opens its view, the last closes it.
    holdThread(rootId: string) {
      const count = (threadHolders.get(rootId) ?? 0) + 1;
      threadHolders.set(rootId, count);
      if (count === 1) void openThread(rootId);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        const left = (threadHolders.get(rootId) ?? 1) - 1;
        if (left > 0) {
          threadHolders.set(rootId, left);
          return;
        }
        threadHolders.delete(rootId);
        dispatch({ type: "threadClosed", rootId });
        forgetItems(channelId, rootId);
      };
    },

    // The page above the oldest message held, once at a time. Past the
    // view's cap the newest end goes and the range stops short of the
    // newest row; the pill brings the reader back (jumpToLatest).
    async older() {
      const mine = life;
      const { log, token, loadingOlder } = state;
      const view = log.channel;
      if (loadingOlder || !token || !view.hasOlder || !view.oldestId) return;
      dispatch({ type: "pagingOlder" });
      try {
        const res = await loadOlder(server.origin, token, channelId, view.oldestId);
        if (!mine.ended) dispatch({ type: "paged", res, generation: view.generation });
      } catch {
        if (!mine.ended) dispatch({ type: "pageFailed" });
      }
    },

    // The page below the newest message held, while the range stops short
    // of the newest row, the same way; past the cap the oldest end goes.
    // Not while a landing is owed: the list reports its newest edge
    // reached as a replaced range lays out, before the landing scroll.
    async newer() {
      const mine = life;
      const { log, token, loadingNewer, landOn } = state;
      const view = log.channel;
      if (loadingNewer || landOn !== null || !token || !view.hasNewer || !view.newestId) return;
      dispatch({ type: "pagingNewer" });
      try {
        const res = await loadNewer(server.origin, token, channelId, view.newestId);
        if (!mine.ended) dispatch({ type: "pagedNewer", res, generation: view.generation });
      } catch {
        if (!mine.ended) dispatch({ type: "newerFailed" });
      }
    },

    // The channel landed on a message (jumpOnce): on the row it holds, or
    // on the page around it. Before the header the open out asks for that
    // page instead, and this answers with it; once the log has gone, or
    // when a later jump takes its place, as superseded. Lands on the root
    // of a reply that shows only in its thread, and names the thread for
    // the caller to open on the reply.
    jumpTo(messageId: string): Promise<JumpResult> {
      const mine = life;
      if (mine.ended) return Promise.resolve(SUPERSEDED);
      if (state.header) return jumpOnce(messageId);
      return new Promise((resolve) => {
        mine.focus?.resolve(SUPERSEDED);
        mine.focus = { id: messageId, resolve };
      });
    },

    // Back to the newest message from a range that stops short of it: the
    // newest page replaces the range (`jumped`), and the list lands at
    // its bottom; one at a time, and nothing while the range reaches the
    // newest row already (the list scrolls there itself). A refusal that
    // means the channel is gone or the sign-in has ended shows as such;
    // any other leaves the range as it was.
    async jumpToLatest() {
      const mine = life;
      const { log, token } = state;
      const view = log.channel;
      if (mine.jumpingLatest || !token || !view.hasNewer || !view.newestId) return;
      mine.jumpingLatest = true;
      try {
        const res = await loadPage(server.origin, token, channelId);
        if (mine.ended || state.log.channel.generation !== view.generation) return;
        dispatch({ type: "jumped", res, generation: view.generation, landOn: "bottom" });
      } catch (err) {
        const outcome = outcomeOf(err);
        if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
      } finally {
        mine.jumpingLatest = false;
      }
    },

    // The list has landed where the state said.
    landed() {
      dispatch({ type: "landed" });
    },

    // The thread's replies above the oldest held, the same way.
    async olderReplies(rootId: string) {
      const mine = life;
      const { log, threads } = state;
      const view = log.threads[rootId];
      const thread = threads[rootId];
      if (!thread || thread.loadingOlder || !view?.hasOlder || !view.oldestId || !olderFits(log, rootId)) return;
      dispatch({ type: "threadPagingOlder", rootId });
      try {
        const res = await loadReplies(server.origin, await token(), channelId, rootId, view.oldestId);
        if (!mine.ended) {
          dispatch({ type: "threadPaged", rootId, epoch: thread.epoch, res, generation: view.generation });
        }
      } catch {
        if (!mine.ended) dispatch({ type: "threadPageFailed", rootId });
      }
    },

    retry() {
      dispatch({ type: "retried" });
      void open();
    },

    retryThread(rootId: string) {
      if (threadHolders.has(rootId)) void openThread(rootId);
    },

    // The reader's marker in the thread moved to its newest reply, and its
    // count cleared here at once (the ThreadRead event that follows says
    // the same). A failure is the caller's, which asks again later.
    async readThread(rootId: string) {
      const mine = life;
      await markThreadRead(server.origin, await token(), rootId);
      if (!mine.ended) dispatch({ type: "threadRead", rootId });
    },

    // The reader's own mute of the thread, or its end, as web sets it:
    // SetThreadMuted, then the root's summary muted (its count cleared)
    // or not (core/channelScreen `threadMuted`; the ThreadMuted event
    // that follows says the same). Nothing changes before the server
    // answers. A refusal is the caller's to show, and nothing once the
    // log has gone; one that means the sign-in has ended shows as such.
    async muteThread(rootId: string, muted: boolean) {
      const mine = life;
      try {
        await setThreadMuted(server.origin, await token(), rootId, muted);
      } catch (err) {
        if (mine.ended) return;
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (!mine.ended) dispatch({ type: "threadMuted", rootId, muted });
    },

    // The reader's own message, quoting another when `to` names one, and
    // in a thread (the channel's timeline too, when asked) when it names
    // that: sent, then its answer merged like an event (the socket's copy
    // usually lands first; the log keeps one row either way). Nothing is
    // shown before the server answers. A refusal that means the channel
    // is gone or the sign-in has ended shows as such, like any other
    // request's, but a NotFound with a root or a quote named is checked
    // first (confirmGone); every other failure is the caller's to show,
    // and the composer puts the draft and the quote back.
    async send(content: string, to: SendTo = {}) {
      const mine = life;
      let message: Message;
      try {
        message = await sendMessage(server.origin, state.token, channelId, content, to);
      } catch (err) {
        if (!mine.ended && notFound(err) && (to.threadRootId || to.replyToMessageId)) {
          void confirmGone(mine, to.threadRootId ?? "");
        } else {
          const outcome = outcomeOf(err);
          if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
        }
        throw err;
      }
      dispatch({ type: "sent", message });
    },

    // The reader's own reaction, as web toggles one: written to the held
    // row at once (core/channelScreen `reacted`, at the row's own seq, so
    // the reactions_changed that follows replaces it), then ToggleReaction,
    // whose answer is merged like a send's. An answer with no row is a
    // toggle saved whose reload failed (api/messages toggleReaction): the
    // patch stands, with no event to follow it, and nothing is said. A
    // refusal puts the reactions back, unless the row has moved on
    // meanwhile, and is the caller's to show; one that means the sign-in
    // has ended shows as such. Once the log has gone (mine.ended) the
    // answer, whichever it is, is nobody's, and a notice would land on
    // whatever screen came next.
    async react(message: Message, emoji: string) {
      const mine = life;
      const { header, token } = state;
      if (!header || !token) return;
      const before = message.reactions;
      const patch = (reactions: typeof before): ScreenAction => ({
        type: "reacted",
        messageId: message.id,
        seq: message.seq,
        reactions,
      });
      dispatch(patch(toggledReactions(before, emoji, header.myUserId)));
      let answer: Message | undefined;
      try {
        answer = await toggleReaction(server.origin, token, message.id, emoji);
      } catch (err) {
        if (mine.ended) return;
        dispatch(patch(before));
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (answer && !mine.ended) dispatch({ type: "sent", message: answer });
    },

    // The reader's own delete, confirmed already: DeleteMessage, then the
    // held row hidden at once (core/channelScreen `deleted`), as the
    // message_deleted that follows makes it. A message already gone from
    // under the confirm (deleted elsewhere while it was open) is nothing to
    // ask for again. A refusal is the caller's to show, as above, and
    // nothing once the log has gone.
    async remove(message: Message) {
      const mine = life;
      const { token, log } = state;
      const held = log.rows.get(message.id);
      if (!token || (held && held.deleted)) return;
      try {
        await deleteMessage(server.origin, token, message.id);
      } catch (err) {
        if (mine.ended) return;
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (!mine.ended) dispatch({ type: "deleted", messageId: message.id });
    },

    // A link's card taken off a message, confirmed already: the
    // message_updated that follows draws the row without it. A refusal is
    // the caller's to show, as above.
    async dismissPreview(message: Message, url: string) {
      const mine = life;
      if (!state.token) return;
      try {
        await dismissLinkPreview(server.origin, state.token, message.id, url);
      } catch (err) {
        if (mine.ended) return;
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
    },

    // The reader's own message with new words: EditMessage, then its answer
    // merged like a send's (the message_updated that follows says the same
    // at the same seq; either order leaves one row). Nothing is shown
    // before the server answers. A refusal is the caller's to show and is
    // always thrown, as a send's is, so one landing after the log has gone
    // is never taken for a save; one that means the sign-in has ended
    // shows as such while the log is still held.
    async edit(messageId: string, content: string) {
      const mine = life;
      let message: Message;
      try {
        message = await editMessage(server.origin, state.token, messageId, content);
      } catch (err) {
        if (!mine.ended && ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (!mine.ended) dispatch({ type: "sent", message });
    },

    // A file picked in the composer, uploaded for this channel (api/files)
    // for a send to claim by id, stopped by the signal. Nothing reaches the
    // log; a refusal is the composer's to show on the file.
    upload(file: LocalFile, signal?: AbortSignal): Promise<UploadedFile> {
      return uploadAttachment(server.origin, state.token, channelId, file, signal);
    },
  };
  return self;
}

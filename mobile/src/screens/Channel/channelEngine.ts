import { Code, ConnectError } from "@connectrpc/connect";
import {
  type ChannelLog,
  channelItems,
  forgetItems,
  hasPage,
  LOG_CAP,
  nextSince,
  threadItems,
  viewOf,
} from "@stoop/core/channelLog";
import { emptyScreen, type Outcome, type ScreenAction, screenReducer } from "@stoop/core/channelScreen";
import { toggledReactions } from "@stoop/core/reactions";
import type { ListMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { AppState } from "react-native";
import {
  ChannelGone,
  deleteMessage,
  editMessage,
  loadChanges,
  loadChannel,
  loadHeader,
  loadAround,
  loadOlder,
  loadPage,
  loadReplies,
  loadRoot,
  markThreadRead,
  PAGE,
  sendMessage,
  toggleReaction,
} from "../../api/messages";
import { sessionToken } from "../../api/servers";
import type { Subscribe } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";

// A channel's log while a screen shows it: the channel screen, and a
// thread screen pushed over it, share one, so a reply, an edit or a read
// lands once for both. Opened on the newest page, grown by a page as the
// reader scrolls up, kept current by the realtime socket's events, and
// after a reconnect or a gap in the events caught up with ListChanges
// from the position it holds (never by fetching what is held again). A
// thread's view is opened on its newest replies while its screen holds
// it, and closed when that goes. The rules are the channel log's
// (core/channelLog) and the screen's state over it core/channelScreen's;
// this makes the requests and dispatches each answer. The log lives
// while any screen holds it and goes with the last (useChannelLog,
// useThread).

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

// A refusal that means the sign-in has ended. For a request about one
// message that is the only answer that says anything about the screen:
// NotFound is the message's, not the channel's, and PermissionDenied says
// what the reader may do to it.
const ended = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

// Whether another older page fits in the channel's view, or a thread's.
// A view holds at most LOG_CAP rows and a page past that prunes the
// newest, the edge the screen keeps live (web shows a pill back to it;
// these screens have no way back yet), so history ends a page short of
// the cap and the screen says so.
export const olderFits = (log: ChannelLog, rootId?: string) =>
  (rootId === undefined ? channelItems(log) : threadItems(log, rootId)).length + PAGE <= LOG_CAP;

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
};

const newLifetime = (): Lifetime => ({ ended: false, opens: 0, catchingUp: null, wake: null });

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

  // The header and the newest page. The latest open is the one whose
  // answer is wanted: a Ready while this one is out opens again, since
  // this one may have read the server before the socket was back, and
  // then this answer is dropped whether it lands before or after. The
  // log is held from the start, so events about the channel have
  // somewhere to go meanwhile; the page's position says whether one of
  // them is still owed.
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
    try {
      const { header, page } = await loadChannel(server.origin, token, spaceId, channelId);
      if (stale()) return;
      dispatch({ type: "opened", header, res: page, token, generation });
      if (state.log.needsCatchUp) void catchUp();
    } catch (err) {
      if (!stale()) dispatch({ type: "failed", outcome: outcomeOf(err) });
    }
  }

  // After a reconnect the header's facts may have changed too (a rename,
  // a member count), and the channel may be gone.
  async function refreshHeader() {
    const mine = life;
    try {
      const header = await loadHeader(server.origin, state.token, spaceId, channelId);
      if (!mine.ended) dispatch({ type: "header", header });
    } catch (err) {
      const outcome = outcomeOf(err);
      if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
    }
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
      dispatch({ type: "event", event });
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

    // The page above the oldest message held, once at a time, while one fits.
    async older() {
      const mine = life;
      const { log, token, loadingOlder } = state;
      const view = log.channel;
      if (loadingOlder || !token || !view.hasOlder || !view.oldestId || !olderFits(log)) return;
      dispatch({ type: "pagingOlder" });
      try {
        const res = await loadOlder(server.origin, token, channelId, view.oldestId);
        if (!mine.ended) dispatch({ type: "paged", res, generation: view.generation });
      } catch {
        if (!mine.ended) dispatch({ type: "pageFailed" });
      }
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

    // The reader's own message, quoting another when replyToMessageId
    // names one: sent, then its answer merged like an event (the socket's
    // copy usually lands first; the log keeps one row either way). Nothing
    // is shown before the server answers. A refusal that means the channel
    // is gone or the sign-in has ended shows as such, like any other
    // request's; every other failure is the caller's to show, and the
    // composer puts the draft and the quote back.
    async send(content: string, replyToMessageId = "") {
      const mine = life;
      let message: Message;
      try {
        message = await sendMessage(server.origin, state.token, channelId, content, replyToMessageId);
      } catch (err) {
        const outcome = outcomeOf(err);
        if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
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
  };
  return self;
}

import type {
  ListChangesResponse,
  ListMessagesResponse,
} from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Reaction } from "../gen/stoop/chat/v1/reaction_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  type ChannelHeader,
  losesChannel,
  withHeaderEvent,
} from "./channelHeader";
import {
  type ChannelLog,
  caughtUp,
  emptyLog,
  FROM_ANSWER,
  opened,
  paged,
  reconnected,
  withArrivals,
  withEvent,
  withPatch,
} from "./channelLog";

// A channel screen's state over its log: the log itself (channelLog owns
// every rule about the rows), the header beside it (channelHeader), and
// the screen's own facts. Each answer and event is one action; the mobile
// app's useChannelLog makes the requests and dispatches them here.

// Why the channel can't be shown.
export type Outcome = "ended" | "gone" | "failed";

export type ChannelScreen = {
  log: ChannelLog;
  // Set once the channel has opened; the screen is ready while it is.
  header: ChannelHeader | null;
  outcome: Outcome | null;
  // The session the channel opened with, for the requests after it.
  token: string;
  // The read marker as it was on opening, so the "New" line stays put as
  // the marker moves; null for no "New" line.
  newAfter: string | null;
  loadingOlder: boolean;
};

export type ScreenAction =
  // The newest page with the header: opening, or opening again after a
  // failure or a reconnect that found the screen still loading. Under the
  // channel view's generation when it was asked for: an answer from
  // before a later open replaced the range is dropped, header and all.
  | {
      type: "opened";
      header: ChannelHeader;
      res: ListMessagesResponse;
      token: string;
      generation: number;
    }
  // The header fetched again after a reconnect.
  | { type: "header"; header: ChannelHeader }
  | { type: "failed"; outcome: Outcome }
  | { type: "retried" }
  | { type: "pagingOlder" }
  // Under the view's generation when the page was asked for; the log drops
  // one for a range since replaced.
  | { type: "paged"; res: ListMessagesResponse; generation: number }
  | { type: "pageFailed" }
  | { type: "event"; event: ServerEvent }
  | { type: "caughtUp"; res: ListChangesResponse }
  | { type: "reconnected" }
  // The answer to the reader's own send, or to their reaction toggle:
  // its row, merged by seq like an event's, as web's holdRow does while
  // the view is live (this screen's always is). The socket's event
  // usually lands first; either order leaves one row, since the server's
  // whole row wins a tie with the event's copy, or with a copy `reacted`
  // patched (FROM_ANSWER). A row, not a page: it answers to no
  // generation and no reconnect, so one that lands across a reconnect
  // or a fresh open is merged all the same, and the catch-up the
  // reconnect owes brings whatever was written around it.
  | { type: "sent"; message: Message }
  // The reader's own reaction, written to the held row at once and at
  // its own seq (channelLog withPatch), so the server's row replaces it:
  // the reactions_changed that follows at a higher seq, or the answer
  // dispatched as `sent`. Only while the row still stands at `seq`, the
  // one the toggle was made on: a refusal is reverted the same way, with
  // the reactions from before, and a row an event has replaced meanwhile
  // carries the server's list already and is left alone.
  | { type: "reacted"; messageId: string; seq: bigint; reactions: Reaction[] }
  // The reader's own delete, answered: the held row as a tombstone at
  // its own seq, gone from the list at once as the message_deleted that
  // follows makes it. A root with a thread summary is left to the
  // server's update for it, which fills the placeholder in.
  | { type: "deleted"; messageId: string };

export const emptyScreen = (channelId: string): ChannelScreen => ({
  log: emptyLog(channelId),
  header: null,
  outcome: null,
  token: "",
  newAfter: null,
  loadingOlder: false,
});

export function screenReducer(
  state: ChannelScreen,
  action: ScreenAction,
): ChannelScreen {
  switch (action.type) {
    case "opened":
      // Nothing a load still out brings back undoes the channel's loss,
      // and a stale open's answer is nobody's.
      if (state.outcome === "gone" || state.outcome === "ended") return state;
      if (action.generation !== state.log.channel.generation) return state;
      return {
        ...state,
        log: opened(state.log, {
          generation: action.generation,
          res: action.res,
        }),
        header: action.header,
        outcome: null,
        token: action.token,
        newAfter: state.header
          ? state.newAfter
          : action.header.channel.lastReadMessageId,
      };
    case "header":
      return state.header ? { ...state, header: action.header } : state;
    case "failed":
      // A load of what is on screen that can't reach the server keeps it.
      if (state.header && action.outcome === "failed") return state;
      return { ...state, outcome: action.outcome };
    case "retried":
      return state.outcome === "failed" ? { ...state, outcome: null } : state;
    case "pagingOlder":
      return { ...state, loadingOlder: true };
    case "paged":
      return {
        ...state,
        log: paged(state.log, "older", {
          generation: action.generation,
          res: action.res,
        }),
        loadingOlder: false,
      };
    case "pageFailed":
      return { ...state, loadingOlder: false };
    case "event": {
      if (loses(state, action.event)) return { ...state, outcome: "gone" };
      const { header } = state;
      const log = withEvent(state.log, action.event);
      const next = header ? withHeaderEvent(header, action.event) : header;
      if (log === state.log && next === header) return state;
      return { ...state, log, header: next };
    }
    case "caughtUp":
      return { ...state, log: caughtUp(state.log, action.res) };
    case "reconnected":
      return { ...state, log: reconnected(state.log) };
    case "sent": {
      // Another channel's row is nobody's here, as with an event.
      if (action.message.channelId !== state.log.channelId) return state;
      const log = withArrivals(state.log, [action.message], FROM_ANSWER);
      return log === state.log ? state : { ...state, log };
    }
    case "reacted": {
      const log = withPatch(state.log, action.messageId, (held) =>
        held.seq === action.seq
          ? { ...held, reactions: action.reactions }
          : held,
      );
      return log === state.log ? state : { ...state, log };
    }
    case "deleted": {
      const log = withPatch(state.log, action.messageId, (held) =>
        held.deleted || held.thread ? held : { ...held, deleted: true },
      );
      return log === state.log ? state : { ...state, log };
    }
  }
}

// Whether the event means the reader can no longer see the channel. With
// no header yet (the first page still out) only the channel's own
// deletion can say so.
function loses(state: ChannelScreen, event: ServerEvent): boolean {
  const { header } = state;
  if (header)
    return losesChannel(
      event,
      header.space.id,
      header.channel.id,
      header.myUserId,
    );
  const payload = event.payload;
  return (
    payload.case === "channelDeleted" &&
    payload.value.channelId === state.log.channelId
  );
}

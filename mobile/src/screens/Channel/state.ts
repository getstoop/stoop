import { type ChannelHeader, losesChannel, withHeaderEvent } from "@stoop/core/channelHeader";
import { type ChannelLog, caughtUp, emptyLog, opened, paged, reconnected, withEvent } from "@stoop/core/channelLog";
import type { ListChangesResponse, ListMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// What the channel screen holds: the channel's log (core/channelLog, which
// owns every rule about the rows), the header beside it
// (core/channelHeader), and the screen's own facts. Each answer and event
// is one action; useChannelLog.ts makes the requests.

// Why the channel can't be shown.
export type Outcome = "ended" | "gone" | "failed";

export type ChannelState = {
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

export type ChannelAction =
  // The newest page with the header: opening, or opening again after a
  // failure or a reconnect that found the screen still loading. The latest
  // answer is the fresher, so each lands over the view as it is.
  | { type: "opened"; header: ChannelHeader; res: ListMessagesResponse; token: string }
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
  | { type: "reconnected" };

export const initialState = (channelId: string): ChannelState => ({
  log: emptyLog(channelId),
  header: null,
  outcome: null,
  token: "",
  newAfter: null,
  loadingOlder: false,
});

export function channelReducer(state: ChannelState, action: ChannelAction): ChannelState {
  switch (action.type) {
    case "opened":
      // Nothing a load still out brings back undoes the channel's loss.
      if (state.outcome === "gone" || state.outcome === "ended") return state;
      return {
        ...state,
        log: opened(state.log, { generation: state.log.channel.generation, res: action.res }),
        header: action.header,
        outcome: null,
        token: action.token,
        newAfter: state.header ? state.newAfter : action.header.channel.lastReadMessageId,
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
        log: paged(state.log, "older", { generation: action.generation, res: action.res }),
        loadingOlder: false,
      };
    case "pageFailed":
      return { ...state, loadingOlder: false };
    case "event": {
      const { header } = state;
      if (header && losesChannel(action.event, header.space.id, header.channel.id, header.myUserId)) {
        return { ...state, outcome: "gone" };
      }
      const log = withEvent(state.log, action.event);
      const next = header ? withHeaderEvent(header, action.event) : header;
      if (log === state.log && next === header) return state;
      return { ...state, log, header: next };
    }
    case "caughtUp":
      return { ...state, log: caughtUp(state.log, action.res) };
    case "reconnected":
      return { ...state, log: reconnected(state.log) };
  }
}

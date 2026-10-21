// The channel log: one log per channel, every row by id, merged by seq,
// with the views that range over it (docs/proposals/channel-log.md). Pure;
// the loader in web/src/api/channelLog.ts makes the requests and keeps the
// logs in its store.

export { caughtUp, nextSince, reconnected } from "./catchUp";
export { channelOfEvent, withEvent } from "./events";
export { withFloor } from "./floor";
export { channelItems, isLive, pendingNewer, threadItems } from "./items";
export { jumped, opened, type PageAnswer, paged } from "./pages";
export { matchesPending } from "./pending";
export { isShown, showsInChannel } from "./rows";
export { sendFailed, sendStarted, sendSucceeded } from "./sends";
export {
  type ChannelLog,
  emptyLog,
  emptyView,
  LOG_CAP,
  type View,
} from "./types";
export { inRange, viewOf } from "./views";

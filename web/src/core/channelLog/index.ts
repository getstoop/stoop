// The channel log: one log per channel, every row by id, merged by seq,
// with the views that range over it (docs/proposals/channel-log.md). Pure;
// the loader in web/src/api/channelLog.ts makes the requests and keeps the
// logs in its store.

export { caughtUp, nextSince, reconnected } from "./catchUp";
export { channelOfEvent, withEvent } from "./events";
export { withFloor } from "./floor";
export { channelItems, forgetItems, threadItems } from "./items";
export { type ThreadOverlay, withThreadOverlay } from "./overlay";
export { jumped, opened, type PageAnswer, paged } from "./pages";
export { isShown, showsInChannel } from "./rows";
export {
  type ChannelLog,
  emptyLog,
  emptyView,
  LOG_CAP,
  type View,
} from "./types";
export { inRange, viewOf } from "./views";

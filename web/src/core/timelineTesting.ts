// Kept for the mobile app, which imports it through @stoop/core; the web
// app no longer uses it (it runs core/channelLog, proposals/channel-log.md).
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  initialTimeline,
  type RequestKind,
  type Timeline,
  type TimelineAction,
  timelineReducer,
} from "./timelineState";

// Fixtures for the timeline reducer's tests as web runs it: no header,
// windows that may stop short of the newest message, pages either way
// under a cap, jumps, refreshes and threads.

export type State = Timeline<undefined>;
export type Action = TimelineAction<undefined>;

export const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, ...init });

export const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

export const page = (ids: string[], hasOlder = true, hasNewer = false) => ({
  messages: ids.map((one) => message(one)),
  hasOlder,
  hasNewer,
});

export const loaded = (
  id: number,
  ids: string[],
  edges: { hasOlder?: boolean; hasNewer?: boolean; rootId?: string } = {},
): Action => ({
  type: "loaded",
  id,
  channelId: "c1",
  rootId: edges.rootId,
  page: page(ids, edges.hasOlder ?? true, edges.hasNewer ?? false),
  header: undefined,
  newAfter: null,
});

export const paged = (
  id: number,
  ids: string[],
  edges: { hasOlder?: boolean; hasNewer?: boolean } = {},
  cap?: number,
): Action => ({
  type: "paged",
  id,
  page: page(ids, edges.hasOlder ?? true, edges.hasNewer ?? false),
  cap,
});

export const start = (
  id: number,
  kind: RequestKind,
  channelId?: string,
): Action => ({ type: "started", id, kind, channelId });

export const run = (
  actions: Action[],
  from: State = initialTimeline as Timeline<undefined>,
) => actions.reduce(timelineReducer<undefined>, from);

// A window from an open: by default the newest page.
export const opened = (
  ids: string[],
  edges: Parameters<typeof loaded>[2] = {},
) => run([start(1, "open"), loaded(1, ids, edges)]);

export const live = (payload: Parameters<typeof event>[0]): Action => ({
  type: "event",
  event: event(payload),
});
export const posted = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
) => live({ case: "messageCreated", value: message(id, init) });
export const edited = (id: string, content: string) =>
  live({ case: "messageUpdated", value: message(id, { content }) });
export const deleted = (id: string) =>
  live({ case: "messageDeleted", value: { channelId: "c1", messageId: id } });

export const ready = (state: State) => {
  if (state.shown.state !== "ready") throw new Error(state.shown.state);
  return state.shown;
};
export const ids = (state: State) =>
  ready(state).page.messages.map((held) => held.id);
export const text = (state: State, id: string) =>
  ready(state).page.messages.find((held) => held.id === id)?.content;

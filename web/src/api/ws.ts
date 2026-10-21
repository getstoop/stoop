import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import { withChannelEvent } from "../core/channelTimeline";
import { ActivityKind } from "../gen/stoop/chat/v1/activity_pb";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import {
  type ClientEvent,
  ClientEventSchema,
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import { useVoiceStore } from "../stores/voice";
import { receiveActivityItem } from "./activity";
import { channelPeopleKey } from "./channelPeople";
import { byPosition, withPositions } from "./channels";
import { authClient } from "./clients";
import { isSignedOut } from "./errors";
import { groupsKey } from "./groups";
import { applyTimelineEvent, isTimelineKey, reconnected } from "./history";
import { isMuted } from "./mutes";
import { hasAttention, maybeDesktopNotify } from "./notifications";
import { socketUrl } from "./origin";
import { applyPinEvent } from "./pins";
import { myDnd, patchMyDnd } from "./presence";
import { refetchOlderThan } from "./stale";
import {
  applyThreadChanged,
  applyThreadMuted,
  applyThreadRead,
  noteMentionInThread,
  openThreadRootId,
} from "./threads";
import { patchChannel, recomputeSpaceUnread, setSpaceUnread } from "./unreads";
import { leaveVoice, reportVoiceState } from "./voice";

// The realtime client: one WebSocket carrying binary ServerEvent frames.
// Events are applied directly to the TanStack Query cache so rendered state
// has a single source of truth; on reconnect we invalidate everything and
// let queries refetch what was missed.

const MAX_BACKOFF_MS = 15_000;

// The live socket, for client → server events (typing). Null while
// disconnected; sends are best-effort.
let liveSocket: WebSocket | null = null;

export function sendClientEvent(
  init: Parameters<typeof create<typeof ClientEventSchema>>[1],
) {
  if (liveSocket?.readyState !== WebSocket.OPEN) return;
  const ev: ClientEvent = create(ClientEventSchema, init);
  liveSocket.send(toBinary(ClientEventSchema, ev));
}

// The gateway's close code when the session this socket was opened with
// was revoked: signed out elsewhere, password changed, or deactivated —
// or replaced, when this browser confirmed it's the person in another tab
// and holds a new session (stillSignedIn).
const CLOSE_CREDENTIAL_REVOKED = 4001;

// After that close: is this browser still signed in, on a newer session?
// Asked of the server directly rather than through the me query, and a
// few times a moment apart, because the replacement is announced before
// the tab that confirmed has stored its new cookie: an early "signed out"
// must not reach the shell, which would go to the login page. undefined
// is no answer at all (the server unreachable), which is not a sign-out.
async function stillSignedIn(): Promise<boolean | undefined> {
  for (const wait of [300, 1000, 2000]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      await authClient.getMe({});
      return true;
    } catch (err) {
      if (!isSignedOut(err)) return undefined;
    }
  }
  return false;
}

export function startRealtime(queryClient: QueryClient): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(socketUrl("/ws"));
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      liveSocket = ws;
      const wasReconnect = attempts > 0;
      attempts = 0;
      useConnectionStore.getState().setStatus("connected");
      // What was missed while disconnected is refetched when Ready lands;
      // the gateway forgot where we are in voice, so remind it. A fresh
      // socket while still in a call needs the same: the call outlives
      // the shell (a trip to /confirm unmounts it and closes the socket),
      // and the server dropped our voice state with the old socket.
      const inCall =
        useVoiceStore.getState().connection?.status === "connected";
      if (wasReconnect || inCall) reportVoiceState();
    };

    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const event = fromBinary(ServerEventSchema, new Uint8Array(e.data));
      applyEvent(queryClient, event);
    };

    ws.onclose = (e: CloseEvent) => {
      liveSocket = null;
      useConnectionStore.getState().setOnline([]);
      if (e.code === CLOSE_CREDENTIAL_REVOKED) {
        useConnectionStore.getState().setStatus("reconnecting");
        void stillSignedIn().then((signedIn) => {
          if (stopped) return;
          if (signedIn === false) {
            // Gone for good: the me query fails, and the shell goes to
            // the login page.
            stopped = true;
            useConnectionStore.getState().setStatus("disconnected");
            void queryClient.invalidateQueries({ queryKey: ["me"] });
            return;
          }
          // On the new session: reconnect now. Server unreachable: the
          // usual backoff; a real sign-out reaches the shell through its
          // own me query, which stops this. Either way it counts as a
          // reconnect, so voice state is reported again.
          retry(signedIn ? 0 : undefined);
        });
        return;
      }
      if (stopped) return;
      retry();
    };
  };

  // Reconnects after the backoff (or after delay), and marks the next open
  // as a reconnect.
  const retry = (delay?: number) => {
    useConnectionStore.getState().setStatus("reconnecting");
    const backoff = delay ?? Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
    attempts += 1;
    reconnectTimer = setTimeout(connect, backoff);
  };

  useConnectionStore.getState().setStatus("connecting");
  connect();
  const sweep = setInterval(
    () => useConnectionStore.getState().expireTyping(),
    1000,
  );

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(sweep);
    ws?.close();
    liveSocket = null;
    useConnectionStore.getState().setStatus("disconnected");
  };
}

function applyEvent(queryClient: QueryClient, event: ServerEvent) {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
      // Sent once this socket is subscribed: anything fetched before now
      // may have missed an event, so it goes again, and a page of history
      // asked for before now is dropped.
      reconnected();
      refetchOlderThan(queryClient, Date.now());
      useConnectionStore.getState().setUserId(payload.value.userId);
      useConnectionStore
        .getState()
        .setOnline(payload.value.presences.map((presence) => presence.userId));
      useConnectionStore.getState().setPresences(payload.value.presences);
      useVoiceStore.getState().setParticipants(payload.value.voiceParticipants);
      break;
    case "voiceStateChanged":
      if (payload.value.participant) {
        useVoiceStore
          .getState()
          .applyChange(payload.value.participant, payload.value.joined);
      }
      break;
    case "presenceChanged":
      useConnectionStore
        .getState()
        .setPresence(
          payload.value.userId,
          payload.value.online,
          payload.value.dnd,
          payload.value.mobile,
        );
      break;
    case "doNotDisturbChanged":
      // Set on this device or another: every device holds alerts alike.
      patchMyDnd(queryClient, payload.value.dnd, payload.value.until);
      break;
    case "userTyping":
      if (payload.value.userId !== useConnectionStore.getState().userId) {
        useConnectionStore
          .getState()
          .setTyping(payload.value.channelId, payload.value.userId);
      }
      break;
    case "messageCreated": {
      const m = payload.value;
      applyTimelineEvent(queryClient, event);
      noteMentionInThread(queryClient, m);
      // A reply that stays in its thread is not in the channel's timeline
      // and does not make the channel unread.
      if (m.threadRootId && !m.inChannel) break;
      const { userId, activeChannelId } = useConnectionStore.getState();
      const mine = m.author?.id === userId;
      const reading = m.channelId === activeChannelId && hasAttention();
      // The channel's newest message moved; if it's ours (or we're looking
      // right at it) the read marker follows, otherwise it goes bold.
      patchChannel(queryClient, m.spaceId, m.channelId, (c) => ({
        lastMessageId: m.id,
        ...(mine || reading
          ? { lastReadMessageId: m.id, unreadCount: 0 }
          : { unreadCount: c.unreadCount + 1 }),
      }));
      if (!mine && !reading) {
        const muted = isMuted(queryClient, m.spaceId, m.channelId);
        if (muted === undefined) {
          // The channel list isn't loaded, so we can't tell whether the
          // channel is muted; the server's has_unread knows.
          queryClient.invalidateQueries({ queryKey: ["spaces"] });
        } else if (!muted) {
          setSpaceUnread(queryClient, m.spaceId, true);
        }
      }
      break;
    }
    case "channelMuted": {
      const c = payload.value;
      patchChannel(queryClient, c.spaceId, c.channelId, { muted: c.muted });
      recomputeSpaceUnread(queryClient, c.spaceId);
      // The mute stamps on items already in the feed are now stale.
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      break;
    }
    case "spaceMuted": {
      // Muted on another device: follow it here.
      const s = payload.value;
      queryClient.setQueryData<Space[]>(["spaces"], (old) =>
        old?.map((x) => (x.id === s.spaceId ? { ...x, muted: s.muted } : x)),
      );
      // The mute stamps on items already in the feed are now stale.
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      break;
    }
    case "channelRead":
      // Read on another device (or this one); clear it everywhere.
      patchChannel(
        queryClient,
        payload.value.spaceId,
        payload.value.channelId,
        {
          lastReadMessageId: payload.value.lastReadMessageId,
          unreadCount: 0,
        },
      );
      recomputeSpaceUnread(queryClient, payload.value.spaceId);
      break;
    case "messageUpdated": {
      // A root deleted while its thread has replies arrives as an update.
      applyMessageEvent(queryClient, payload.value.channelId, event);
      break;
    }
    case "threadChanged": {
      // The root's summary line: count, last reply, faces, and our count.
      const t = payload.value;
      applyThreadChanged(queryClient, t.channelId, t.rootMessageId, t.thread);
      break;
    }
    case "threadMuted": {
      const t = payload.value;
      applyThreadMuted(queryClient, t.channelId, t.rootMessageId, t.muted);
      break;
    }
    case "threadRead": {
      const t = payload.value;
      applyThreadRead(queryClient, t.channelId, t.rootMessageId);
      break;
    }
    case "messagePinned": {
      // The delta, not the list: mark the message, drop the pin list.
      applyPinEvent(queryClient, payload.value);
      break;
    }
    case "reactionsChanged": {
      // Swap in the message's full reaction list; no refetch, no unread
      // effect, no activity item.
      applyMessageEvent(queryClient, payload.value.channelId, event);
      break;
    }
    case "messageDeleted": {
      const d = payload.value;
      // A root that goes takes its thread's window with it.
      applyMessageEvent(queryClient, d.channelId, event);
      // The channel's newest message may have changed; refetch the list.
      queryClient.invalidateQueries({
        queryKey: d.spaceId ? ["channels", d.spaceId] : ["dms"],
      });
      break;
    }
    case "channelUpdated": {
      const c = payload.value;
      queryClient.invalidateQueries({ queryKey: ["all-channels"] });
      queryClient.setQueryData<Channel[]>(["channels", c.spaceId], (old) =>
        old
          ? byPosition(
              old.map((x) =>
                x.id === c.id
                  ? {
                      ...x,
                      name: c.name,
                      position: c.position,
                      topic: c.topic,
                      postPolicy: c.postPolicy,
                    }
                  : x,
              ),
            )
          : old,
      );
      break;
    }
    case "channelDeleted":
      applyTimelineEvent(queryClient, event);
      queryClient.invalidateQueries({ queryKey: ["all-channels"] });
      queryClient.setQueryData<Channel[]>(
        ["channels", payload.value.spaceId],
        (old) => old?.filter((x) => x.id !== payload.value.channelId),
      );
      queryClient.removeQueries({
        queryKey: ["messages", payload.value.channelId],
      });
      // Its alerts went with it, and so did its share of the space's dot.
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      recomputeSpaceUnread(queryClient, payload.value.spaceId);
      useVoiceStore.getState().dropChannel(payload.value.channelId);
      if (
        useVoiceStore.getState().connection?.channelId ===
        payload.value.channelId
      ) {
        leaveVoice();
      }
      break;
    case "channelsReordered":
      queryClient.invalidateQueries({ queryKey: ["all-channels"] });
      queryClient.setQueryData<Channel[]>(
        ["channels", payload.value.spaceId],
        (old) => (old ? withPositions(old, payload.value.channels) : old),
      );
      break;
    case "channelCreated":
      queryClient.invalidateQueries({ queryKey: ["all-channels"] });
      // A DM someone opened with us arrives here too (no space).
      queryClient.invalidateQueries({
        queryKey: payload.value.spaceId
          ? ["channels", payload.value.spaceId]
          : ["dms"],
      });
      break;
    case "spaceJoined":
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      break;
    case "channelMemberJoined":
    case "channelMemberLeft":
      queryClient.invalidateQueries({
        queryKey: channelPeopleKey(payload.value.channelId),
      });
      queryClient.invalidateQueries({ queryKey: ["all-channels"] });
      break;
    case "activityItemCreated": {
      const item = payload.value.item;
      if (item) {
        receiveActivityItem(queryClient, item);
        // No banner while reading that DM or thread, while we're on Do not
        // disturb, or from somewhere we muted — the server stamped that on
        // the item, so it holds even for a space this tab has never opened.
        const { activeChannelId } = useConnectionStore.getState();
        const reading = item.channelId === activeChannelId && hasAttention();
        const readingThread =
          item.threadRootId !== "" &&
          item.threadRootId === openThreadRootId() &&
          hasAttention();
        maybeDesktopNotify(
          item,
          activityPath(item),
          myDnd(queryClient) ||
            item.muted ||
            readingThread ||
            (reading && item.kind === ActivityKind.DM),
        );
      }
      break;
    }
    case "memberJoined":
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      break;
    case "memberRoleChanged":
      queryClient.invalidateQueries({
        queryKey: ["member", payload.value.spaceId, payload.value.userId],
      });
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      // If it was us, our my_role changed too.
      if (payload.value.userId === useConnectionStore.getState().userId) {
        queryClient.invalidateQueries({ queryKey: ["spaces"] });
      }
      break;
    case "memberUpdated":
      // Profile change (avatar): refetch them wherever they're shown,
      // including the avatar beside their messages. An avatar is set by a
      // job after the upload returns, so our own and a bot's go too.
      queryClient.invalidateQueries({
        queryKey: ["member", payload.value.spaceId, payload.value.userId],
      });
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({
        queryKey: ["user-profile", payload.value.userId],
      });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      if (payload.value.userId === useConnectionStore.getState().userId) {
        queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      break;
    case "memberRemoved":
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      queryClient.removeQueries({
        queryKey: ["member", payload.value.spaceId, payload.value.userId],
      });
      // Leaving a space takes someone out of its private channels and its
      // groups with no event of its own.
      queryClient.invalidateQueries({ queryKey: ["channel-people"] });
      queryClient.invalidateQueries({
        queryKey: groupsKey(payload.value.spaceId),
      });
      // Their messages stay, and what they are shown as may have changed:
      // an account deleting itself leaves every space this way.
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      // If it was us, the spaces list shrinks and SpaceLayout bounces home.
      if (payload.value.userId === useConnectionStore.getState().userId) {
        queryClient.invalidateQueries({ queryKey: ["spaces"] });
        leaveVoiceIn(payload.value.spaceId);
      }
      break;
    case "groupsChanged":
      queryClient.invalidateQueries({
        queryKey: groupsKey(payload.value.spaceId),
      });
      // Messages carry a group's current handle, so a rename shows on
      // old messages too.
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      break;
    case "spaceUpdated": {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      // The space's voice switch decides which channels it lists.
      const space = payload.value.space;
      if (space) {
        queryClient.invalidateQueries({ queryKey: ["channels", space.id] });
        if (!space.voiceEnabled) leaveVoiceIn(space.id);
      }
      break;
    }
    case "spaceDeleted": {
      const id = payload.value.spaceId;
      queryClient.setQueryData<Space[]>(["spaces"], (old) =>
        old?.filter((s) => s.id !== id),
      );
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      leaveVoiceIn(id);
      break;
    }
    default:
      break;
  }
}

// Where an activity item points: a space channel, or a direct message.
export function activityPath(item: {
  spaceId: string;
  channelId: string;
}): string {
  return item.spaceId
    ? `/s/${item.spaceId}/c/${item.channelId}`
    : `/dm/${item.channelId}`;
}

// Kicked from, or lost, the space we're talking in.
function leaveVoiceIn(spaceId: string) {
  if (useVoiceStore.getState().connection?.spaceId === spaceId) leaveVoice();
}

// Drops a message the reader deleted from every window of its channel, as
// its MessageDeleted will. A root that goes takes its thread's window
// with it.
export function removeMessageFromCache(
  queryClient: QueryClient,
  channelId: string,
  messageId: string,
) {
  applyMessageEvent(
    queryClient,
    channelId,
    create(ServerEventSchema, {
      payload: { case: "messageDeleted", value: { channelId, messageId } },
    }),
  );
  queryClient.removeQueries({
    queryKey: ["messages", channelId, messageId],
    exact: true,
  });
}

// Swaps in a message's new version (the reader's edit) in every window of
// its channel, as its MessageUpdated will.
export function replaceMessage(queryClient: QueryClient, message: Message) {
  applyMessageEvent(
    queryClient,
    message.channelId,
    create(ServerEventSchema, {
      payload: { case: "messageUpdated", value: message },
    }),
  );
}

// An edit, a deletion or a reaction: through the reducer for the
// timelines, and straight onto the copies beside them.
function applyMessageEvent(
  queryClient: QueryClient,
  channelId: string,
  event: ServerEvent,
) {
  applyTimelineEvent(queryClient, event);
  applyBesideTimelines(queryClient, channelId, event);
}

// Also used by the send-message mutation, so delivery via RPC response and
// via the WS event converge on the same deduped write. A message goes to
// the timeline it shows in: its channel's, its thread's, or both.
export function appendMessage(queryClient: QueryClient, message: Message) {
  applyTimelineEvent(
    queryClient,
    create(ServerEventSchema, {
      payload: { case: "messageCreated", value: message },
    }),
  );
}

// An edit, a deletion or a reaction, for the copies of messages that sit
// beside the timelines: a thread's root, a linked message. The timelines
// take theirs through applyTimelineEvent.
function applyBesideTimelines(
  queryClient: QueryClient,
  channelId: string,
  event: ServerEvent,
) {
  queryClient.setQueriesData<Message[]>(
    {
      queryKey: ["messages", channelId],
      predicate: (query) => !isTimelineKey(query.queryKey),
    },
    (old) => old && withChannelEvent(old, event, channelId),
  );
}

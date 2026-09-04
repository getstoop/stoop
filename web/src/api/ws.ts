import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import { ActivityKind } from "../gen/stoop/chat/v1/activity_pb";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import {
  type ClientEvent,
  ClientEventSchema,
  PresenceStatus,
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import { useVoiceStore } from "../stores/voice";
import { receiveActivityItem } from "./activity";
import { isLive, useHistoryStore } from "./history";
import { isMuted } from "./mutes";
import { hasAttention, maybeDesktopNotify } from "./notifications";
import { setReactions } from "./reactions";
import { announceStatus, loadStatusPreference, startIdleWatch } from "./status";
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

export function startRealtime(queryClient: QueryClient): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      liveSocket = ws;
      const wasReconnect = attempts > 0;
      attempts = 0;
      useConnectionStore.getState().setStatus("connected");
      if (wasReconnect) {
        // Recover whatever we missed while disconnected, and remind the
        // gateway where we are in voice (it forgot on disconnect).
        queryClient.invalidateQueries();
        reportVoiceState();
      }
    };

    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const event = fromBinary(ServerEventSchema, new Uint8Array(e.data));
      applyEvent(queryClient, event);
    };

    ws.onclose = () => {
      liveSocket = null;
      useConnectionStore.getState().setOnline([]);
      if (stopped) return;
      useConnectionStore.getState().setStatus("reconnecting");
      const backoff = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
      attempts += 1;
      reconnectTimer = setTimeout(connect, backoff);
    };
  };

  useConnectionStore.getState().setStatus("connecting");
  useConnectionStore.getState().setMyStatus(loadStatusPreference());
  connect();
  const sweep = setInterval(
    () => useConnectionStore.getState().expireTyping(),
    1000,
  );
  const stopIdleWatch = startIdleWatch();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(sweep);
    stopIdleWatch();
    ws?.close();
    liveSocket = null;
    useConnectionStore.getState().setStatus("disconnected");
  };
}

function applyEvent(queryClient: QueryClient, event: ServerEvent) {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
      useConnectionStore.getState().setUserId(payload.value.userId);
      useConnectionStore.getState().setOnline(payload.value.onlineUserIds);
      useConnectionStore.getState().setPresences(payload.value.presences);
      useVoiceStore.getState().setParticipants(payload.value.voiceParticipants);
      // The gateway forgot our status with the last connection.
      announceStatus();
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
          payload.value.status,
        );
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
      appendMessage(queryClient, m);
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
      const m = payload.value;
      queryClient.setQueryData<Message[]>(["messages", m.channelId], (old) =>
        old?.map((x) => (x.id === m.id ? m : x)),
      );
      break;
    }
    case "reactionsChanged": {
      // Swap in the message's full reaction list; no refetch, no unread
      // effect, no activity item.
      const r = payload.value;
      setReactions(queryClient, r.channelId, r.messageId, r.reactions);
      break;
    }
    case "messageDeleted": {
      const d = payload.value;
      removeMessageFromCache(queryClient, d.channelId, d.messageId);
      // The channel's newest message may have changed; refetch the list.
      queryClient.invalidateQueries({
        queryKey: d.spaceId ? ["channels", d.spaceId] : ["dms"],
      });
      break;
    }
    case "channelUpdated": {
      const c = payload.value;
      queryClient.setQueryData<Channel[]>(["channels", c.spaceId], (old) =>
        old?.map((x) =>
          x.id === c.id
            ? { ...x, name: c.name, position: c.position, topic: c.topic }
            : x,
        ),
      );
      break;
    }
    case "channelDeleted":
      queryClient.setQueryData<Channel[]>(
        ["channels", payload.value.spaceId],
        (old) => old?.filter((x) => x.id !== payload.value.channelId),
      );
      queryClient.removeQueries({
        queryKey: ["messages", payload.value.channelId],
      });
      useVoiceStore.getState().dropChannel(payload.value.channelId);
      if (
        useVoiceStore.getState().connection?.channelId ===
        payload.value.channelId
      ) {
        leaveVoice();
      }
      break;
    case "channelsReordered": {
      const order = new Map(payload.value.channels.map((c, i) => [c.id, i]));
      queryClient.setQueryData<Channel[]>(
        ["channels", payload.value.spaceId],
        (old) =>
          old
            ? [...old].sort(
                (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
              )
            : old,
      );
      break;
    }
    case "channelCreated":
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
    case "activityItemCreated": {
      const item = payload.value.item;
      if (item) {
        receiveActivityItem(queryClient, item);
        // No banner while reading that DM, while we're on Do not disturb,
        // or from somewhere we muted — the server stamped that on the item,
        // so it holds even for a space this tab has never opened.
        const { activeChannelId, myStatus } = useConnectionStore.getState();
        const reading = item.channelId === activeChannelId && hasAttention();
        maybeDesktopNotify(
          item,
          activityPath(item),
          myStatus === PresenceStatus.DND ||
            item.muted ||
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
      // including the avatar beside their messages.
      queryClient.invalidateQueries({
        queryKey: ["member", payload.value.spaceId, payload.value.userId],
      });
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      break;
    case "memberRemoved":
      queryClient.invalidateQueries({
        queryKey: ["members", payload.value.spaceId],
      });
      queryClient.removeQueries({
        queryKey: ["member", payload.value.spaceId, payload.value.userId],
      });
      // If it was us, the spaces list shrinks and SpaceLayout bounces home.
      if (payload.value.userId === useConnectionStore.getState().userId) {
        queryClient.invalidateQueries({ queryKey: ["spaces"] });
        leaveVoiceIn(payload.value.spaceId);
      }
      break;
    case "spaceUpdated":
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      break;
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

// Drops a message from the cache and blanks the quote on any reply to it
// (the server does the same on the next fetch).
export function removeMessageFromCache(
  queryClient: QueryClient,
  channelId: string,
  messageId: string,
) {
  queryClient.setQueryData<Message[]>(["messages", channelId], (old) =>
    old
      ?.filter((x) => x.id !== messageId)
      .map((x) =>
        x.replyTo?.messageId === messageId
          ? { ...x, replyTo: { ...x.replyTo, author: undefined, preview: "" } }
          : x,
      ),
  );
}

// Also used by the send-message mutation, so delivery via RPC response and
// via the WS event converge on the same deduped cache write.
export function appendMessage(queryClient: QueryClient, message: Message) {
  const key = ["messages", message.channelId];
  const current = queryClient.getQueryData<Message[]>(key);
  if (current === undefined) {
    // The channel's history isn't in the cache yet. If a fetch is in
    // flight it may have started before this message existed, so make
    // sure it's refetched rather than silently dropping the event.
    if (queryClient.getQueryState(key)?.fetchStatus === "fetching") {
      queryClient.invalidateQueries({ queryKey: key });
    }
    return;
  }
  if (current.some((m) => m.id === message.id)) return;
  // The window isn't at the newest message (the reader jumped into
  // history): the message belongs beyond its edge, so count it on the
  // "Jump to latest" pill rather than splicing it in out of order.
  const history = useHistoryStore.getState();
  if (!isLive(history.channels[message.channelId])) {
    history.noteArrival(message.channelId);
    return;
  }
  queryClient.setQueryData<Message[]>(key, [...current, message]);
}

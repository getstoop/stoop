import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  dmTitle,
  useChannelRecord,
  useDirectMessages,
  usePeople,
} from "../../api/dms";
import { useMe, useMessages, useSpaces } from "../../api/queries";
import { joinVoice } from "../../api/voice";
import { ChannelTopic } from "../../components/ChannelTopic";
import { MenuButton } from "../../components/MenuButton";
import { SearchLauncher } from "../../components/SearchLauncher";
import { SpeakerIcon } from "../../components/VoiceIcons";
import { VoiceStage } from "../../components/VoiceStage";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useAutoReadActivity } from "../../hooks/useAutoRead";
import { useMarkChannelRead } from "../../hooks/useMarkChannelRead";
import { useConnectionStore } from "../../stores/connection";
import { useVoiceStore } from "../../stores/voice";
import { DMTitle } from "../DirectMessages";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

const CHAT_HIDDEN_KEY = "stoop.voiceChatHidden";

function loadChatHidden(): boolean {
  try {
    return localStorage.getItem(CHAT_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveChatHidden(hidden: boolean): boolean {
  try {
    localStorage.setItem(CHAT_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // fine
  }
  return hidden;
}

export function ChannelView() {
  const params = useParams({ strict: false }) as {
    spaceId?: string;
    channelId: string;
  };
  const channelId = params.channelId;
  // "" for a direct message (/dm/$channelId): no space, no members —
  // the people come from the DM's participants (api/dms.ts).
  const spaceId = params.spaceId ?? "";
  const { channel, loaded } = useChannelRecord(spaceId, channelId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const isDM = spaceId === "";
  // What to call the conversation: the channel's name, or the other person.
  const { data: dms } = useDirectMessages(isDM);
  const { data: meForTitle } = useMe();
  const dm = isDM ? dms?.find((d) => d.channel?.id === channelId) : undefined;
  const title = isDM
    ? dm
      ? dmTitle(dm, meForTitle?.id)
      : ""
    : (channel?.name ?? "");
  // ?m=<messageId>: open the window around that message rather than the
  // newest page (activity, shared links).
  const { m: jumpTarget } = useSearch({ strict: false }) as { m?: string };
  const { data: messages } = useMessages(channelId, jumpTarget);
  // Deleted (or never existed): back to the space's first channel, or
  // the DM list.
  const navigate = useNavigate();
  useEffect(() => {
    if (!loaded || channel) return;
    if (spaceId) {
      navigate({ to: "/s/$spaceId", params: { spaceId }, replace: true });
    } else {
      navigate({ to: "/dm", replace: true });
    }
  }, [loaded, channel, navigate, spaceId]);
  // Where "new" starts: the read marker as it was when this channel was
  // opened. Snapshotted so the divider doesn't chase the marker as the
  // hook below advances it.
  const [divider, setDivider] = useState<{
    channelId: string;
    afterId: string;
  } | null>(null);
  if (channel && divider?.channelId !== channelId) {
    setDivider({ channelId, afterId: channel.lastReadMessageId });
  }
  useAutoReadActivity(channelId);
  useMarkChannelRead(spaceId, channelId);
  // In this voice channel: its stage sits above the chat from the moment
  // the join starts and stays for as long as we're in it, whatever the
  // status — connecting, connected, or failed. The stage itself says
  // which (VoiceStage).
  const onStage = useVoiceStore((s) => s.connection?.channelId === channelId);
  // Hiding the chat hands the whole pane to the video; the choice is
  // kept per browser (the toggle lives on the stage, VoiceStage) and
  // only ever applies while we're on a stage — a text channel always
  // has its timeline.
  const [chatHidden, setChatHidden] = useState(loadChatHidden);
  const stage = channel?.kind === ChannelKind.VOICE && onStage;
  const hideChat = stage && chatHidden;
  // The message being replied to, if any; cleared on send or Esc.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drop a pending reply when switching channels
  useEffect(() => setReplyTo(null), [channelId]);

  return (
    <main className="channel-view">
      <header className="channel-header">
        <MenuButton />
        {channel?.kind === ChannelKind.DM ? (
          <DMTitle channelId={channelId} />
        ) : (
          <>
            <span className="channel-hash">
              {channel?.kind === ChannelKind.VOICE ? <SpeakerIcon /> : "#"}
            </span>
            <span className="channel-title">{channel?.name ?? "…"}</span>
          </>
        )}
        {channel && <ChannelTopic channel={channel} space={space} />}
        {channel?.kind === ChannelKind.VOICE && (
          <JoinVoiceChip spaceId={spaceId} channelId={channel.id} />
        )}
        {!isDM && <SearchLauncher spaceId={spaceId} channelId={channelId} />}
      </header>
      {stage && (
        <VoiceStage
          spaceId={spaceId}
          channelId={channelId}
          chatHidden={chatHidden}
          onToggleChat={() => setChatHidden(saveChatHidden(!chatHidden))}
        />
      )}
      {!hideChat && (
        <>
          <MessageList
            key={channelId}
            messages={messages ?? []}
            spaceId={spaceId}
            channelId={channelId}
            channelName={title}
            dm={isDM}
            newAfterId={
              divider?.channelId === channelId ? divider.afterId : null
            }
            jumpTarget={jumpTarget}
            onReply={setReplyTo}
          />
          <TypingIndicator channelId={channelId} spaceId={spaceId} />
          <Composer
            channelId={channelId}
            channelName={title}
            dm={isDM}
            spaceId={spaceId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </>
      )}
    </main>
  );
}

// "bea is typing…" — names resolved from the members list.
function TypingIndicator({
  channelId,
  spaceId,
}: {
  channelId: string;
  spaceId: string;
}) {
  const typing = useConnectionStore((s) => s.typing[channelId]);
  const members = usePeople(spaceId, channelId);
  const names = Object.keys(typing ?? {})
    .map((id) => members?.find((m) => m.userId === id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => m.displayName || m.username);
  const label =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : "Several people are typing…";
  return (
    <div className="typing-indicator" aria-live="polite">
      {label}
    </div>
  );
}

// In a voice channel's text timeline: one click to join (or a note that
// you're already in it).
function JoinVoiceChip({
  spaceId,
  channelId,
}: {
  spaceId: string;
  channelId: string;
}) {
  const status = useVoiceStore((s) =>
    s.connection?.channelId === channelId ? s.connection.status : null,
  );
  return (
    <button
      type="button"
      className="chip join-voice"
      // A failed join leaves us "in" the channel with nothing connected:
      // the chip goes back to offering the join.
      disabled={status === "connected" || status === "connecting"}
      onClick={() => joinVoice(spaceId, channelId)}
    >
      {status === "connected"
        ? "Connected"
        : status === "connecting"
          ? "Connecting…"
          : "Join voice"}
    </button>
  );
}

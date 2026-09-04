import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useMembers } from "../api/queries";
import { joinVoice } from "../api/voice";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { useSpeaking } from "../hooks/useSpeaking";
import { participantsIn, useVoiceStore } from "../stores/voice";
import { Avatar } from "./Avatar";
import { Tooltip } from "./Tooltip";
import {
  CameraIcon,
  HeadphonesIcon,
  ScreenIcon,
  SpeakerIcon,
} from "./VoiceIcons";

// A voice channel in the sidebar: clicking joins it — muted, camera off —
// and opens its view, where the stage sits above the chat. Everyone
// currently in it is listed underneath with a deafened flag and a ring
// while they speak.
export function VoiceChannel({
  spaceId,
  channel,
}: {
  spaceId: string;
  channel: Channel;
}) {
  const navigate = useNavigate();
  const status = useVoiceStore((s) =>
    s.connection?.channelId === channel.id ? s.connection.status : "",
  );

  const label =
    status === "connected" ? `Open ${channel.name}` : `Join ${channel.name}`;

  return (
    <div className="voice-channel" data-channel-id={channel.id}>
      {/* With a topic the label moves into the tooltip, which can carry
          it underneath; without one the native title is enough. */}
      <Tooltip
        text={channel.topic ? label : undefined}
        detail={channel.topic}
        side="right"
      >
        <button
          type="button"
          className={`channel-link voice ${status}`}
          // Join and go: the join is a no-op once we're already in it, so
          // clicking a channel we're in just opens it again.
          onClick={() => {
            joinVoice(spaceId, channel.id);
            navigate({
              to: "/s/$spaceId/c/$channelId",
              params: { spaceId, channelId: channel.id },
            });
          }}
          title={channel.topic ? undefined : label}
          aria-label={label}
        >
          <span className="channel-hash">
            <SpeakerIcon />
          </span>
          <span className="channel-name">{channel.name}</span>
        </button>
      </Tooltip>
      <VoiceParticipants spaceId={spaceId} channelId={channel.id} />
    </div>
  );
}

function VoiceParticipants({
  spaceId,
  channelId,
}: {
  spaceId: string;
  channelId: string;
}) {
  // Select the stable record and derive here: a selector returning a new
  // array each call would re-render forever under useSyncExternalStore.
  const all = useVoiceStore((s) => s.participants);
  const participants = useMemo(
    () => participantsIn(all, channelId),
    [all, channelId],
  );
  const speaking = useSpeaking();
  const { data: members } = useMembers(spaceId);
  if (participants.length === 0) return null;
  const byId = new Map(members?.map((m) => [m.userId, m]));
  return (
    <ul className="voice-participants">
      {participants.map((p) => {
        const m = byId.get(p.userId);
        const name = m?.displayName || m?.username || "…";
        return (
          <li
            key={p.userId}
            className={`voice-participant ${speaking.has(p.userId) ? "speaking" : ""}`}
            data-user-id={p.userId}
          >
            <Avatar name={name} fileId={m?.avatarFileId} size="small" />
            <span className="member-name">{name}</span>
            {p.screenSharing && (
              <span className="voice-flag live" title="Sharing their screen">
                <ScreenIcon />
              </span>
            )}
            {p.camera && (
              <span className="voice-flag live" title="Camera on">
                <CameraIcon />
              </span>
            )}
            {/* Muted lives on the stage tile now (VoiceStage); deafened
                stays here, since it is about what they can hear and has
                no tile of its own. */}
            {p.deafened && (
              <span className="voice-flag" title="Deafened">
                <HeadphonesIcon off />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

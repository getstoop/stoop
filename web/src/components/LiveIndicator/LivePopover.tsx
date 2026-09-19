import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { captureState } from "../../api/capture";
import { useChannels, useSpaces } from "../../api/queries";
import {
  leaveVoice,
  toggleCamera,
  toggleMute,
  toggleScreenShare,
} from "../../api/voice";
import { useVoiceStore } from "../../stores/voice";
import { CameraIcon, MicIcon, ScreenIcon } from "../VoiceIcons";
import { POPOVER_WIDTH } from "./position";

// What is live, one action each, then the way to the channel. No
// Disconnect: a global one is too easy to hit by accident.
export function LivePopover({
  at,
  onClose,
}: {
  at: { top: number; left: number };
  onClose: () => void;
}) {
  const connection = useVoiceStore((s) => s.connection);
  const muted = useVoiceStore((s) => s.muted);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(connection?.spaceId ?? "");
  if (!connection) return null;

  const capture = captureState({ connection, muted, cameraOn, screenOn });
  const space = spaces?.find((s) => s.id === connection.spaceId);
  const channel = channels?.find((c) => c.id === connection.channelId);
  const style: CSSProperties = { ...at, width: POPOVER_WIDTH };

  return (
    <div className="live-popover popover" style={style}>
      <div className="live-popover-head">
        <strong>{channel?.name ?? "…"}</strong>
        <span>{space?.name ?? "…"}</span>
      </div>
      {capture.kind === "error" ? (
        <Row
          className="error"
          label={connection.error || "Couldn't join voice"}
          action="Dismiss"
          onClick={() => {
            onClose();
            void leaveVoice();
          }}
        />
      ) : capture.kind === "joining" ? (
        <p className="live-popover-note">Joining…</p>
      ) : (
        <>
          {capture.screen && (
            <Row
              className="screen"
              icon={<ScreenIcon />}
              label="Sharing your screen"
              action="Stop"
              onClick={() => void toggleScreenShare()}
            />
          )}
          <Row
            className={capture.camera ? "live" : ""}
            icon={<CameraIcon off={!capture.camera} />}
            label={capture.camera ? "Camera on" : "Camera off"}
            action={capture.camera ? "Turn off" : "Turn on"}
            onClick={() => void toggleCamera()}
          />
          <Row
            className={capture.mic ? "live" : ""}
            icon={<MicIcon off={!capture.mic} />}
            label={capture.mic ? "Microphone live" : "Microphone muted"}
            action={capture.mic ? "Mute" : "Unmute"}
            onClick={() => void toggleMute()}
          />
        </>
      )}
      <Link
        to="/s/$spaceId/c/$channelId"
        params={{
          spaceId: connection.spaceId,
          channelId: connection.channelId,
        }}
        className="live-popover-go"
        onClick={onClose}
      >
        Go to {channel?.name ?? "the channel"}
      </Link>
    </div>
  );
}

function Row({
  className,
  icon,
  label,
  action,
  onClick,
}: {
  className: string;
  icon?: ReactNode;
  label: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className={`live-popover-row ${className}`}>
      {icon}
      <span className="live-popover-label">{label}</span>
      <button type="button" className="chip" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

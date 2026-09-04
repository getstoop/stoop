import { useEffect, useState } from "react";
import { useChannels, useSpaces } from "../api/queries";
import {
  leaveVoice,
  listCameras,
  listMicrophones,
  resumeAudio,
  switchCamera,
  switchMicrophone,
} from "../api/voice";
import { useVoiceStore } from "../stores/voice";
import { VoiceActions } from "./VoiceActions";

// The "connected to voice" panel at the bottom of the channel sidebar:
// where we are, the device pickers, and the shared controls (VoiceActions
// — the stage bar carries the same row). It follows the user across
// spaces, so it is rendered from the space layout regardless of which
// space is on screen.
export function VoiceBar() {
  const connection = useVoiceStore((s) => s.connection);
  const audioBlocked = useVoiceStore((s) => s.audioBlocked);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const videoError = useVoiceStore((s) => s.videoError);
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(connection?.spaceId ?? "");
  if (!connection) return null;

  const space = spaces?.find((s) => s.id === connection.spaceId);
  const channel = channels?.find((c) => c.id === connection.channelId);
  const where = `${channel?.name ?? "…"} · ${space?.name ?? "…"}`;

  if (connection.status === "error") {
    return (
      <section className="voice-bar error" aria-live="polite">
        <div className="voice-bar-status">
          <strong>Couldn't join voice</strong>
          <span className="voice-bar-where">{connection.error}</span>
        </div>
        <button type="button" className="chip" onClick={() => leaveVoice()}>
          Dismiss
        </button>
      </section>
    );
  }

  return (
    <section className="voice-bar" aria-live="polite">
      <div className="voice-bar-status">
        <strong>
          {connection.status === "connecting"
            ? "Connecting…"
            : "Voice connected"}
        </strong>
        <span className="voice-bar-where">{where}</span>
      </div>
      {audioBlocked && (
        <button type="button" className="chip" onClick={() => resumeAudio()}>
          Enable audio
        </button>
      )}
      {videoError && <span className="voice-bar-error">{videoError}</span>}
      <div className="voice-bar-devices">
        <MicrophonePicker enabled={connection.status === "connected"} />
        <CameraPicker enabled={cameraOn} />
      </div>
      <VoiceActions />
    </section>
  );
}

// Front / back on a phone, webcams on a desktop; only while the camera is
// on (that's when the permission, and so the labels, exist).
function CameraPicker({ enabled }: { enabled: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!enabled) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    listCameras()
      .then((d) => !cancelled && setDevices(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  if (devices.length < 2) return null;
  return (
    <select
      className="voice-mic-select"
      aria-label="Camera"
      title="Camera"
      onChange={(e) => switchCamera(e.target.value)}
    >
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || "Camera"}
        </option>
      ))}
    </select>
  );
}

// Only shown when there is a choice to make. Labels are available once
// the microphone permission has been granted, which joining does.
function MicrophonePicker({ enabled }: { enabled: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listMicrophones()
      .then((d) => !cancelled && setDevices(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  if (devices.length < 2) return null;
  return (
    <select
      className="voice-mic-select"
      aria-label="Microphone"
      title="Microphone"
      onChange={(e) => switchMicrophone(e.target.value)}
    >
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || "Microphone"}
        </option>
      ))}
    </select>
  );
}

import { useChannels, useSpaces } from "../api/queries";
import { leaveVoice, resumeAudio } from "../api/voice";
import { useVoiceStore } from "../stores/voice";
import { DevicePicker } from "./DevicePicker";
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
        <DevicePicker
          kind="audioinput"
          enabled={connection.status === "connected"}
        />
        {/* Front / back on a phone, webcams on a desktop; only while the
            camera is on, which is when its permission and labels exist. */}
        <DevicePicker kind="videoinput" enabled={cameraOn} />
      </div>
      <VoiceActions />
    </section>
  );
}

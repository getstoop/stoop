import { useChannels, useSpaces } from "../api/queries";
import { leaveVoice, resumeAudio } from "../api/voice";
import { useVoiceStore } from "../stores/voice";
import { DevicePicker } from "./DevicePicker";
import { VoiceActions } from "./VoiceActions";
import { HangUpIcon } from "./VoiceIcons";

// The "connected to voice" panel at the bottom of the channel sidebar,
// from the top: where we are with Disconnect beside it, the device list,
// and the shared toggles as tiles (VoiceActions — the stage bar carries
// the same set as a row). Disconnect sits apart from the toggles as the
// one action that ends the call rather than changing it. The bar follows
// the user across spaces, so it is rendered from the space layout
// regardless of which space is on screen.
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
      <section className="voice-bar error">
        <div className="voice-bar-head">
          <div className="voice-bar-status" aria-live="polite">
            <strong>Couldn't join voice</strong>
            <span className="voice-bar-where">{connection.error}</span>
          </div>
          <button type="button" className="chip" onClick={() => leaveVoice()}>
            Dismiss
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="voice-bar">
      <div className="voice-bar-head">
        <div className="voice-bar-status" aria-live="polite">
          <strong>
            {connection.status === "connecting"
              ? "Connecting…"
              : "Voice connected"}
          </strong>
          <span className="voice-bar-where">{where}</span>
        </div>
        <button
          type="button"
          className="icon-button voice-bar-leave"
          aria-label="Disconnect"
          title="Disconnect"
          onClick={() => leaveVoice()}
        >
          <HangUpIcon />
        </button>
      </div>
      {audioBlocked && (
        <button type="button" className="chip" onClick={() => resumeAudio()}>
          Enable audio
        </button>
      )}
      <div className="voice-bar-devices">
        <DevicePicker
          kind="audioinput"
          enabled={connection.status === "connected"}
        />
        {/* Front / back on a phone, webcams on a desktop. The row is
            always there and reads "Camera off" until the camera is on,
            which is when its permission and labels exist. */}
        <DevicePicker kind="videoinput" enabled={cameraOn} />
      </div>
      {videoError && <span className="voice-bar-error">{videoError}</span>}
      <VoiceActions layout="tiles" />
    </section>
  );
}

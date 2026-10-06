import {
  canShareScreen,
  leaveVoice,
  toggleCamera,
  toggleDeafen,
  toggleMute,
  toggleScreenShare,
} from "../api/voice";
import { useVoiceStore } from "../stores/voice";
import {
  CameraIcon,
  HangUpIcon,
  HeadphonesIcon,
  MicIcon,
  ScreenIcon,
} from "./VoiceIcons";

// The voice controls themselves — camera, screen, mic, deafen, hang up.
// Both bars render this one row: the sidebar's VoiceBar, which follows
// you across spaces, and the StageBar over the video, which in full
// screen is the only one on the page. Two copies of these buttons would
// have drifted the first time one of them gained a state.
//
// `extras` are the buttons that only exist on the stage (hide chat, full
// screen). They come after the toggles and before the hang-up, which is
// always last.
export function VoiceActions({ extras }: { extras?: React.ReactNode }) {
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  // Camera and screen need a room to publish into; mute, deafen and
  // hang up are ours to press while the join is still in flight.
  const connected = useVoiceStore((s) => s.connection?.status === "connected");
  return (
    <div className="voice-actions">
      <button
        type="button"
        className={`icon-button video ${cameraOn ? "live" : ""}`}
        aria-pressed={cameraOn}
        aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
        title={cameraOn ? "Turn camera off" : "Turn camera on"}
        disabled={!connected}
        onClick={() => toggleCamera()}
      >
        <CameraIcon off={!cameraOn} />
      </button>
      {canShareScreen() && (
        <button
          type="button"
          className={`icon-button video ${screenOn ? "live" : ""}`}
          aria-pressed={screenOn}
          aria-label={screenOn ? "Stop sharing" : "Share your screen"}
          title={screenOn ? "Stop sharing" : "Share your screen"}
          disabled={!connected}
          onClick={() => toggleScreenShare()}
        >
          <ScreenIcon off={!screenOn} />
        </button>
      )}
      <button
        type="button"
        className={`icon-button ${muted ? "on" : ""}`}
        aria-pressed={muted}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        onClick={() => toggleMute()}
      >
        <MicIcon off={muted} />
      </button>
      <button
        type="button"
        className={`icon-button ${deafened ? "on" : ""}`}
        aria-pressed={deafened}
        aria-label={deafened ? "Undeafen" : "Deafen"}
        title={deafened ? "Undeafen" : "Deafen"}
        onClick={() => toggleDeafen()}
      >
        <HeadphonesIcon off={deafened} />
      </button>
      {extras}
      <button
        type="button"
        className="icon-button danger"
        aria-label="Disconnect"
        title="Disconnect"
        onClick={() => leaveVoice()}
      >
        <HangUpIcon />
      </button>
    </div>
  );
}

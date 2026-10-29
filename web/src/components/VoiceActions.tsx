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
import { VoiceVolume } from "./VoiceVolume";

// The voice controls themselves — camera, screen, mic, deafen, volume.
// Both bars render this one set: the sidebar's VoiceBar, which follows
// you across spaces, and the StageBar over the video, which in full
// screen is the only one on the page. Two copies of these buttons would
// have drifted the first time one of them gained a state.
//
// `layout` is the arrangement. "row" is the stage's pill of icon
// buttons, with the `extras` that only exist there (hide chat, full
// screen) after the toggles and the hang-up always last. "tiles" is the
// sidebar's grid of equal tiles, where Disconnect is not among them: the
// bar draws its own, apart, as the one action that ends the call.
export function VoiceActions({
  layout,
  extras,
}: {
  layout: "row" | "tiles";
  extras?: React.ReactNode;
}) {
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  // Camera and screen need a room to publish into; mute, deafen and
  // hang up are ours to press while the join is still in flight.
  const connected = useVoiceStore((s) => s.connection?.status === "connected");
  return (
    <div className={`voice-actions ${layout}`}>
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
      <VoiceVolume />
      {layout === "row" && (
        <>
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
        </>
      )}
    </div>
  );
}

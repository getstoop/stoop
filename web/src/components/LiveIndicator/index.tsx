import { useCallback, useEffect, useRef, useState } from "react";
import { type Capture, captureLabel, captureState } from "../../api/capture";
import { useChannels, useSpaces } from "../../api/queries";
import { useVoiceStore } from "../../stores/voice";
import { Tooltip } from "../Tooltip";
import { CameraIcon, MicIcon, ScreenIcon } from "../VoiceIcons";
import { LivePopover } from "./LivePopover";
import { type Placement, popoverPosition } from "./position";

// Says what is live — mic, camera, screen — on every page: a pill at the
// top of the rail, and beside the menu button on a phone, where the rail
// is inside the drawer. docs/proposals/live-indicator.md.
export function LiveIndicator({ placement }: { placement: Placement }) {
  const connection = useVoiceStore((s) => s.connection);
  const muted = useVoiceStore((s) => s.muted);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(connection?.spaceId ?? "");
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [at, close]);

  const capture = captureState({ connection, muted, cameraOn, screenOn });
  if (capture.kind === "none") return null;

  const label = captureLabel(capture);
  const space = spaces?.find((s) => s.id === connection?.spaceId);
  const channel = channels?.find((c) => c.id === connection?.channelId);
  const where = channel && space ? `${channel.name} · ${space.name}` : "";

  return (
    <div ref={ref} className={`live-indicator ${placement}`}>
      <Tooltip
        text={label}
        detail={where}
        side={placement === "rail" ? "right" : "bottom"}
      >
        <button
          type="button"
          className={`icon-button live-pill ${capture.kind}`}
          aria-label={where ? `${label}: ${where}` : label}
          aria-expanded={at !== null}
          onClick={(e) =>
            setAt(
              at
                ? null
                : popoverPosition(
                    e.currentTarget.getBoundingClientRect(),
                    placement,
                    window.innerWidth,
                  ),
            )
          }
        >
          <PillIcon capture={capture} />
        </button>
      </Tooltip>
      {placement === "rail" && (
        <span className="rail-divider" aria-hidden="true" />
      )}
      {at && <LivePopover at={at} onClose={close} />}
    </div>
  );
}

// The loudest thing live, and — when that is the camera or the screen —
// the mic's own state in a bubble on its corner.
function PillIcon({ capture }: { capture: Capture }) {
  const main =
    capture.kind === "screen" ? (
      <ScreenIcon />
    ) : capture.kind === "camera" ? (
      <CameraIcon />
    ) : (
      <MicIcon off={capture.kind === "muted"} />
    );
  const bubble = capture.kind === "screen" || capture.kind === "camera";
  return (
    <>
      {main}
      {bubble && (
        <span className={`live-pill-mic ${capture.mic ? "" : "off"}`}>
          <MicIcon off={!capture.mic} />
        </span>
      )}
    </>
  );
}

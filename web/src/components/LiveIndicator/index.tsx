import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Capture, captureLabel, captureState } from "../../api/capture";
import { useChannels, useSpaces } from "../../api/queries";
import { useVoiceStore, type VoiceConnection } from "../../stores/voice";
import { Tooltip } from "../Tooltip";
import { CameraIcon, MicIcon, ScreenIcon } from "../VoiceIcons";
import { LivePopover } from "./LivePopover";
import { type Placement, popoverPosition } from "./position";

// How long a pill stays after its call ends: a little past the 260ms outro
// in live-indicator.css, which holds its last frame, so the unmount never
// lands a frame before the rail has finished closing up.
const OUTRO_MS = 320;

// The call each placement last introduced itself for. The header pill
// remounts with every page, and the intro belongs to the call, not the page.
const introduced: Record<Placement, string | null> = {
  rail: null,
  header: null,
};

interface Live {
  capture: Capture;
  connection: VoiceConnection;
}

// Says what is live — mic, camera, screen — on every page: a pill at the
// top of the rail, and beside the menu button on a phone, where the rail
// is inside the drawer. docs/proposals/live-indicator.md.
export function LiveIndicator({ placement }: { placement: Placement }) {
  const connection = useVoiceStore((s) => s.connection);
  const muted = useVoiceStore((s) => s.muted);
  const cameraOn = useVoiceStore((s) => s.cameraOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const switching = useVoiceStore((s) => s.switching);
  const capture = captureState({ connection, muted, cameraOn, screenOn });
  const live =
    connection && capture.kind !== "none" ? { capture, connection } : null;
  const { shown, leaving } = useLingering(live, switching, placement);
  if (!shown) return null;
  return (
    <LivePill
      placement={placement}
      capture={shown.capture}
      connection={shown.connection}
      leaving={leaving}
    />
  );
}

// Keeps the last call on screen long enough to animate out once it ends,
// and holds it still — as joining — while moving to another channel, so a
// switch is neither an exit nor an arrival.
function useLingering(
  live: Live | null,
  switching: boolean,
  placement: Placement,
) {
  const last = useRef<Live | null>(null);
  const [ending, setEnding] = useState<Live | null>(null);
  if (live) last.current = live;
  const held: Live | null =
    !live && switching && last.current
      ? {
          connection: last.current.connection,
          capture: {
            kind: "joining",
            mic: false,
            camera: false,
            screen: false,
          },
        }
      : null;
  const inCall = live !== null || held !== null;

  useEffect(() => {
    if (inCall) {
      setEnding(null);
      return;
    }
    introduced[placement] = null;
    const gone = last.current;
    last.current = null;
    if (!gone || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    setEnding(gone);
    const id = setTimeout(() => setEnding(null), OUTRO_MS);
    return () => clearTimeout(id);
  }, [inCall, placement]);

  return {
    shown: live ?? held ?? ending,
    leaving: !live && !held && ending !== null,
  };
}

// Mounted when a call starts, so its first render is the call's first
// moment: that is when it moves, once.
function LivePill({
  placement,
  capture,
  connection,
  leaving,
}: {
  placement: Placement;
  capture: Capture;
  connection: VoiceConnection;
  leaving: boolean;
}) {
  const callKey = `${connection.spaceId}/${connection.channelId}`;
  const [intro] = useState(() => introduced[placement] !== callKey);
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(connection.spaceId);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);

  useEffect(() => {
    introduced[placement] = callKey;
  }, [placement, callKey]);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !popRef.current?.contains(target))
        close();
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

  const label = captureLabel(capture);
  const space = spaces?.find((s) => s.id === connection.spaceId);
  const channel = channels?.find((c) => c.id === connection.channelId);
  const where = channel && space ? `${channel.name} · ${space.name}` : "";
  const phase = leaving ? "outro" : intro ? "intro" : "";

  return (
    <div ref={ref} className={`live-indicator ${placement} ${phase}`}>
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
          tabIndex={leaving ? -1 : undefined}
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
      {/* On the body, so no animating or scrolling ancestor can clip it
          or become what its fixed position is measured from. */}
      {at &&
        !leaving &&
        createPortal(
          <div ref={popRef}>
            <LivePopover at={at} onClose={close} />
          </div>,
          document.body,
        )}
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

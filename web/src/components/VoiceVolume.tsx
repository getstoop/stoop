import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_VOLUME,
  MAX_VOLUME,
  useVoiceVolumeStore,
  VOLUME_STEP,
} from "../api/voiceVolume";
import { SpeakerIcon } from "./VoiceIcons";

// The volume button of the voice controls and the panel it opens: how
// loud the call plays on this device, 0 to 200%, one slider for
// everyone in it. The value lives in api/voiceVolume.ts and the sound is
// set in api/voice.ts; this is only the control. The panel is fixed to
// the viewport above the button, as the ⋮ menu is, so the stage bar's
// pill cannot clip it; Escape, a click outside or a scroll closes it.

const WIDTH = 224;
const GAP = 6;

// Centred over the button and clear of the window's edges.
function panelPosition(anchor: DOMRect): CSSProperties {
  const left = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - WIDTH / 2),
    window.innerWidth - WIDTH - 8,
  );
  return { left, bottom: window.innerHeight - anchor.top + GAP, width: WIDTH };
}

export function VoiceVolume() {
  const volume = useVoiceVolumeStore((s) => s.volume);
  const setVolume = useVoiceVolumeStore((s) => s.setVolume);
  const [open, setOpen] = useState(false);
  // Where the button was when the panel opened.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    const t = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const boosted = volume > DEFAULT_VOLUME;
  const label = `Voice volume · ${volume}%`;
  return (
    <div ref={ref} className="voice-volume-anchor">
      <button
        type="button"
        className={`icon-button ${open ? "open" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        ref={buttonRef}
        onClick={() => {
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          setOpen((o) => !o);
        }}
      >
        <SpeakerIcon off={volume === 0} boosted={boosted} />
      </button>
      {open && anchor && (
        <div
          className="voice-volume popover"
          role="dialog"
          aria-label="Voice volume"
          style={panelPosition(anchor)}
        >
          <div className="voice-volume-head">
            <label htmlFor={id}>Voice volume</label>
            <output htmlFor={id} className={boosted ? "boosted" : ""}>
              {volume}%
            </output>
          </div>
          <input
            id={id}
            type="range"
            min={0}
            max={MAX_VOLUME}
            step={VOLUME_STEP}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <div className="voice-volume-marks" aria-hidden="true">
            <span>0%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
          <button
            type="button"
            className="link"
            onClick={() => setVolume(DEFAULT_VOLUME)}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

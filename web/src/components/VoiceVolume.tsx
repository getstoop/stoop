import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_VOLUME,
  MAX_VOLUME,
  useVoiceVolumeStore,
  VOLUME_STEP,
} from "../api/voiceVolume";
import { Switch } from "./Switch";
import { SpeakerIcon } from "./VoiceIcons";

// The volume button of the voice controls and the panel it opens: how
// loud the call plays on this device, 0 to 300%, one slider for
// everyone in it. The value lives in api/voiceVolume.ts and the sound is
// set in api/voice.ts; this is only the control. Under the slider three
// words mark its ends and the as-sent point; the readout stays a number,
// since the keys step by 10 and the number is what moves. Under the
// marks, the "Even out voices" switch: it lives here and not on Account
// → Voice because that tab is hidden inside the desktop app, and the
// popover reaches both. Reset puts the volume back and leaves the switch
// alone. The panel is fixed to the viewport above the button, as the ⋮
// menu is, so the stage bar's pill cannot clip it; Escape, a click
// outside or a scroll closes it.

// Wide enough for the switch's words beside it on one line.
const WIDTH = 240;
const GAP = 6;
// The slider's thumb is the browser's own (voice.css keeps the native
// control), about this wide everywhere. Its centre travels from half a
// thumb in from one end to half a thumb short of the other, so a mark
// under a value sits at that fraction of the track less the thumb, plus
// the half.
const THUMB = 16;

// Where the thumb's centre is for a value, as a CSS length.
function markLeft(value: number): string {
  const f = value / MAX_VOLUME;
  return `calc(${f * 100}% + ${(0.5 - f) * THUMB}px)`;
}

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
  const evenOut = useVoiceVolumeStore((s) => s.evenOut);
  const setEvenOut = useVoiceVolumeStore((s) => s.setEvenOut);
  const [open, setOpen] = useState(false);
  // Where the button was when the panel opened.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const evenId = `${id}-even`;
  const evenHintId = `${id}-even-hint`;

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
            <span>Off</span>
            <span style={{ left: markLeft(DEFAULT_VOLUME) }}>Normal</span>
            <span>Loudest</span>
          </div>
          <div className="voice-volume-even">
            <div className="voice-volume-even-text">
              <label htmlFor={evenId}>Even out voices</label>
              <span id={evenHintId} className="muted">
                Louder volumes may distort sound.
              </span>
            </div>
            <Switch
              id={evenId}
              checked={evenOut}
              aria-describedby={evenHintId}
              onChange={(e) => setEvenOut(e.target.checked)}
            />
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

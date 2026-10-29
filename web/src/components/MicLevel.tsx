import { litSegments, SEGMENTS } from "../api/micLevel";
import { useVoiceStore } from "../stores/voice";

const INDEXES = Array.from({ length: SEGMENTS }, (_, index) => index + 1);

// Your own mic's level, drawn in the voice bar's mic row: ten segments
// lit from the left as you talk, the highest recent one holding a moment
// and sliding down, dimmer. Amber when the mic has been quiet (the row
// carries the hint), dark while muted. The numbers come from
// api/voiceLevel.ts through the store; this only draws them.
//
// It selects segment counts, not the levels, so it renders only when a
// segment changes rather than on every sample.
export function MicLevel() {
  const muted = useVoiceStore((s) => s.muted);
  const quiet = useVoiceStore((s) => s.micLevel.quiet);
  const lit = useVoiceStore((s) =>
    s.muted ? 0 : litSegments(s.micLevel.level),
  );
  const top = useVoiceStore((s) =>
    s.muted ? 0 : litSegments(s.micLevel.peak),
  );
  const state = muted ? ", muted" : quiet ? ", quiet" : "";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <meter> cannot be drawn as segments
    <span
      role="meter"
      className={`mic-level${quiet ? " quiet" : ""}`}
      aria-label="Your mic level"
      aria-valuemin={0}
      aria-valuemax={SEGMENTS}
      aria-valuenow={lit}
      aria-valuetext={`${lit} of ${SEGMENTS}${state}`}
    >
      {INDEXES.map((segment) => (
        <span
          key={segment}
          className={
            segment <= lit ? "lit" : segment === top ? "peak" : undefined
          }
        />
      ))}
    </span>
  );
}

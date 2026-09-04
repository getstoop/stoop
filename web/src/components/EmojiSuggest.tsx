import type { Shortcode } from "../api/shortcodes";

// Autocomplete list shown above the composer while typing :shortcode.
export function EmojiSuggest({
  candidates,
  selected,
  onPick,
}: {
  candidates: Shortcode[];
  selected: number;
  onPick: (s: Shortcode) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul className="mention-picker emoji-suggest" aria-label="Insert an emoji">
      {candidates.map((s, i) => (
        <li key={s.code}>
          <button
            type="button"
            className={`mention-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(s);
            }}
          >
            <span className="emoji-suggest-emoji">{s.emoji}</span>
            <span className="muted small">:{s.code}:</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

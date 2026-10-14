import { useRef } from "react";
import type { Shortcode } from "../api/shortcodes";
import { useScrollToSelected } from "../hooks/useScrollToSelected";

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
  const listRef = useRef<HTMLUListElement>(null);
  useScrollToSelected(listRef, selected);
  if (candidates.length === 0) return null;
  return (
    <ul
      ref={listRef}
      className="mention-picker emoji-suggest popover"
      aria-label="Insert an emoji"
    >
      {candidates.map((s, i) => (
        <li key={s.code}>
          <button
            type="button"
            className={`option mention-option ${i === selected ? "selected" : ""}`}
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

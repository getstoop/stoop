import { useEffect, useRef, useState } from "react";
import {
  COMMON_EMOJI,
  emojiName,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
} from "../api/emoji";
import { EMOJI_GROUPS } from "../api/emojiData";

// The reaction picker, anchored below the button that opened it (same
// placement rules as UserCard): a text filter over every emoji's name,
// recently used from localStorage, a curated row of common emoji, then the
// whole set by group.
export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => recentEmoji());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred so the click that opened the picker doesn't close it.
    const id = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const pick = (emoji: string) => {
    setRecent(rememberEmoji(emoji));
    onPick(emoji);
    onClose();
  };

  const width = 300;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - width - 8),
  );
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 360);
  const results = query.trim() ? searchEmoji(query) : null;

  const grid = (className: string, emojis: string[]) => (
    <div className={`emoji-grid ${className}`}>
      {emojis.map((e) => (
        <button
          key={e}
          type="button"
          className="emoji-option"
          title={emojiName(e)}
          aria-label={emojiName(e)}
          onClick={() => pick(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={ref}
      className="emoji-picker"
      role="dialog"
      aria-label="Add reaction"
      style={{ left, top, width }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results && results.length > 0) {
            e.preventDefault();
            pick(results[0].emoji);
          }
        }}
        placeholder="Search emoji"
        aria-label="Search emoji"
        autoComplete="off"
      />
      <div className="emoji-body">
        {results ? (
          results.length > 0 ? (
            grid(
              "emoji-results",
              results.map((r) => r.emoji),
            )
          ) : (
            <p className="muted small">No emoji match “{query}”</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <div className="emoji-section">Recent</div>
                {grid("emoji-recent", recent)}
              </>
            )}
            <div className="emoji-section">Common</div>
            {grid("emoji-common", COMMON_EMOJI)}
            {EMOJI_GROUPS.map(([name, entries]) => (
              <div key={name} className="emoji-group">
                <div className="emoji-section">{name}</div>
                {grid(
                  "emoji-all",
                  entries.map(([e]) => e),
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

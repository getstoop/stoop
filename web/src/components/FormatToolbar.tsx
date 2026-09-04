import { type Format, shortcutHint } from "../api/formatting";

// The formatting row above the composer/editor. Buttons keep the textarea
// focused (mousedown is cancelled) so the selection they act on survives.
const BUTTONS: {
  format: Format;
  label: string;
  hint?: string;
  glyph: string;
}[] = [
  { format: "bold", label: "Bold", hint: "B", glyph: "B" },
  { format: "italic", label: "Italic", hint: "I", glyph: "I" },
  { format: "underline", label: "Underline", hint: "U", glyph: "U" },
  { format: "strike", label: "Strikethrough", hint: "⇧X", glyph: "S" },
  { format: "code", label: "Inline code", hint: "E", glyph: "</>" },
  { format: "spoiler", label: "Spoiler", glyph: "▚" },
  { format: "quote", label: "Quote", glyph: "❝" },
  { format: "list", label: "Bulleted list", glyph: "•—" },
  { format: "orderedList", label: "Numbered list", glyph: "1." },
  { format: "codeblock", label: "Code block", glyph: "{ }" },
];

export function FormatToolbar({ onFormat }: { onFormat: (f: Format) => void }) {
  return (
    <div className="format-toolbar">
      {BUTTONS.map((b) => (
        <button
          key={b.format}
          type="button"
          className={`format-button format-${b.format}`}
          title={b.hint ? `${b.label} (${shortcutHint(b.hint)})` : b.label}
          aria-label={b.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormat(b.format)}
        >
          {b.glyph}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from "react";
import { type Format, shortcutHint } from "../api/formatting";
import { BulletListIcon, NumberedListIcon } from "./Icons";
import { Tooltip } from "./Tooltip";

// The formatting row above the composer/editor. Buttons keep the editor
// focused (mousedown is cancelled) so the selection they act on survives.
// A button shows pressed while its format is in effect at the caret.
const BUTTONS: {
  format: Format;
  label: string;
  hint?: string;
  glyph: ReactNode;
}[] = [
  { format: "bold", label: "Bold", hint: "B", glyph: "B" },
  { format: "italic", label: "Italic", hint: "I", glyph: "I" },
  { format: "underline", label: "Underline", hint: "U", glyph: "U" },
  { format: "strike", label: "Strikethrough", hint: "⇧X", glyph: "S" },
  { format: "code", label: "Inline code", hint: "E", glyph: "</>" },
  { format: "spoiler", label: "Spoiler", glyph: "▚" },
  { format: "quote", label: "Quote", glyph: "❝" },
  { format: "list", label: "Bulleted list", glyph: <BulletListIcon /> },
  {
    format: "orderedList",
    label: "Numbered list",
    glyph: <NumberedListIcon />,
  },
  { format: "codeblock", label: "Code block", glyph: "{ }" },
];

export function FormatToolbar({
  active,
  onFormat,
}: {
  active: Format[];
  onFormat: (f: Format) => void;
}) {
  return (
    <div className="format-toolbar">
      {BUTTONS.map((b) => (
        <Tooltip
          key={b.format}
          text={b.hint ? `${b.label} (${shortcutHint(b.hint)})` : b.label}
        >
          <button
            type="button"
            className={`format-button format-${b.format}`}
            aria-label={b.label}
            aria-pressed={active.includes(b.format)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormat(b.format)}
          >
            {b.glyph}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

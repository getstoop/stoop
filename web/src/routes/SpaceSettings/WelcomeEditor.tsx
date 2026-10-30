import { useRef, useState } from "react";
import { type Format, shortcutFormat } from "../../api/formatting";
import { FormatToolbar } from "../../components/FormatToolbar";
import { RichEditor, type RichField } from "../../components/RichEditor";

// The server's own limit, mirrored so the field can count down rather
// than let a save fail (internal/chat/spaces.go).
const WELCOME_MAX = 4000;

// The welcome, written in the composer's editor with its toolbar, so it
// reads as it will when a member arrives (WelcomeText renders it with
// the message renderer). Enter breaks the line here; nothing is sent
// until the form's Save. A greeting names no one, so @handles stay text.
export function WelcomeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  const ref = useRef<RichField>(null);
  const [formats, setFormats] = useState<Format[]>([]);
  return (
    <div className="welcome-editor">
      <FormatToolbar
        active={formats}
        onFormat={(f) => ref.current?.format(f)}
      />
      <RichEditor
        fieldRef={ref}
        label="Welcome"
        value={value}
        onChange={(markdown) => onChange(markdown)}
        onFormats={setFormats}
        onKeyDown={(e) => {
          const shortcut = shortcutFormat(e);
          if (shortcut) {
            e.preventDefault();
            ref.current?.format(shortcut);
          }
        }}
        placeholder="Say hi in #general; #tools is the lending library."
      />
      <span
        className={`small ${value.length > WELCOME_MAX ? "error" : "muted"}`}
      >
        {value.length} / {WELCOME_MAX}
      </span>
    </div>
  );
}

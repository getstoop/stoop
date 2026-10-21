import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { type Format, shortcutFormat } from "../../api/formatting";
import { replaceShortcodes } from "../../api/shortcodes";
import { replaceMessage } from "../../api/ws";
import { FormatToolbar } from "../../components/FormatToolbar";
import { RichEditor, type RichField } from "../../components/RichEditor";
import type { MentionContext } from "../../components/RichEditor/mentions";
import { isBlankMessage } from "../../core/markdown";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useTouchKeyboard } from "../../hooks/useTouchKeyboard";

// Inline editor: Enter saves, Shift+Enter breaks the line, Esc cancels,
// empty content is refused. An on-screen keyboard's Return breaks the line,
// so there the editor has Save and Cancel buttons.
export function MessageEditor({
  message,
  mentions,
  onDone,
}: {
  message: Message;
  // Who the message's mentions name, so they read with current handles.
  mentions: MentionContext;
  onDone: () => void;
}) {
  const [value, setValue] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const [formats, setFormats] = useState<Format[]>([]);
  const queryClient = useQueryClient();
  const ref = useRef<RichField>(null);
  const touchKeyboard = useTouchKeyboard();

  const save = async () => {
    const written = replaceShortcodes(ref.current?.sendable() ?? value);
    const content = written.trim();
    if (content === message.content) {
      onDone();
      return;
    }
    if (isBlankMessage(written)) {
      setError("A message can't be empty — delete it instead.");
      return;
    }
    try {
      const res = await chatClient.editMessage({
        messageId: message.id,
        content,
      });
      if (res.message) replaceMessage(queryClient, res.message);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="message-editor">
      <FormatToolbar
        active={formats}
        onFormat={(f) => ref.current?.format(f)}
      />
      <RichEditor
        fieldRef={ref}
        onFormats={setFormats}
        value={value}
        mentions={mentions}
        autoFocus
        onChange={(markdown) => setValue(markdown)}
        onKeyDown={(e) => {
          const shortcut = shortcutFormat(e);
          if (shortcut) {
            e.preventDefault();
            ref.current?.format(shortcut);
          } else if (e.key === "Enter" && !e.shiftKey) {
            if (touchKeyboard) return;
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
      />
      {touchKeyboard ? (
        <div className="message-editor-actions">
          <button type="button" className="chip" onClick={onDone}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
            Save
          </button>
        </div>
      ) : (
        <span className="muted small">
          Enter to save · Shift+Enter for a new line · Esc to cancel
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

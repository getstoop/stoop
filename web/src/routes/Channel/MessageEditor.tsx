import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { replaceShortcodes } from "../../api/shortcodes";
import { ComposerOverlay } from "../../components/ComposerOverlay";
import { FormatToolbar } from "../../components/FormatToolbar";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useAutoGrow } from "../../hooks/useAutoGrow";
import { useFormatting } from "../../hooks/useFormatting";

// Inline editor: Enter saves, Shift+Enter breaks the line, Esc cancels,
// empty content is refused.
export function MessageEditor({
  message,
  onDone,
}: {
  message: Message;
  onDone: () => void;
}) {
  const [value, setValue] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value);
  const { apply: format, onShortcut } = useFormatting(ref, setValue);

  // Focus once with the caret at the end.
  useEffect(() => {
    const end = message.content.length;
    ref.current?.focus();
    ref.current?.setSelectionRange(end, end);
  }, [message.content.length]);

  const save = async () => {
    const content = replaceShortcodes(value).trim();
    if (!content) {
      setError("A message can't be empty — delete it instead.");
      return;
    }
    if (content === message.content) {
      onDone();
      return;
    }
    try {
      const res = await chatClient.editMessage({
        messageId: message.id,
        content,
      });
      if (res.message) {
        const m = res.message;
        queryClient.setQueryData<Message[]>(["messages", m.channelId], (old) =>
          old?.map((x) => (x.id === m.id ? m : x)),
        );
      }
      onDone();
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : String(err));
    }
  };

  return (
    <div className="message-editor">
      <FormatToolbar onFormat={format} />
      <div className="composer-input">
        <ComposerOverlay value={value} textareaRef={ref} />
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (onShortcut(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              onDone();
            }
          }}
          maxLength={4000}
        />
      </div>
      <span className="muted small">
        Enter to save · Shift+Enter for a new line · Esc to cancel
      </span>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

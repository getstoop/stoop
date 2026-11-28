import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  BellIcon,
  CalendarIcon,
  PaperclipIcon,
  PlusIcon,
  PollIcon,
  SendIcon,
} from "../../components/Icons";
import { Tooltip } from "../../components/Tooltip";
import type { Command, CommandName } from "../../core/commands";

// A command's mark in the menu. Every command has one: a new name in
// core/commands.ts does not compile until it is given one here.
const ICONS: Record<CommandName, ReactNode> = {
  poll: <PollIcon />,
  when: <CalendarIcon />,
  remind: <BellIcon size={16} />,
};

// The row along the bottom of the composer's box: a plus that opens a
// menu of the commands offered here (each also reachable by typing its
// name), the paperclip, then what helps with the words: the switch for
// the formatting row and an @ that opens the mention list. Where no
// command is offered (a thread) the plus is not drawn. The two that act
// on the words keep the editor focused (mousedown is cancelled), so the
// caret stays where it was. At the far end is Send, the form's submit:
// dimmed while there is nothing to send, but never disabled, so a press
// on it then still leaves the caret (and a phone's keyboard) alone.
export function ComposerActions({
  commands,
  onCommand,
  onFiles,
  formatting,
  formattingId,
  onFormatting,
  onMention,
  canSend,
}: {
  commands: Command[];
  onCommand: (name: CommandName) => void;
  onFiles: (files: FileList) => void;
  // Whether the formatting row is shown, and the row's id.
  formatting: boolean;
  formattingId: string;
  onFormatting: (shown: boolean) => void;
  onMention: () => void;
  // Whether a send would post anything now.
  canSend: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="composer-actions">
      {commands.length > 0 && (
        <MoreMenu commands={commands} onCommand={onCommand} />
      )}
      <Tooltip text="Attach files">
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
        >
          <PaperclipIcon />
        </button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
        aria-label="Attach files"
      />
      <span className="composer-actions-divider" aria-hidden="true" />
      <Tooltip text={formatting ? "Hide formatting" : "Show formatting"}>
        <button
          type="button"
          className="icon-button composer-format-toggle"
          aria-label="Formatting"
          aria-pressed={formatting}
          aria-controls={formattingId}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormatting(!formatting)}
        >
          Aa
        </button>
      </Tooltip>
      <Tooltip text="Mention someone" describes={false}>
        <button
          type="button"
          className="icon-button composer-mention"
          aria-label="Mention someone"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onMention}
        >
          @
        </button>
      </Tooltip>
      <Tooltip text="Send" describes={false}>
        <button
          type="submit"
          className="primary composer-send"
          aria-label="Send"
          aria-disabled={!canSend || undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          <SendIcon />
        </button>
      </Tooltip>
    </div>
  );
}

// The plus and its menu, which opens above it. Closed by Escape, a press
// outside it, or a pick. A pick puts focus on the plus before the
// command's form opens, so a form closed without posting returns focus
// there, as a dialog does to whatever opened it.
function MoreMenu({
  commands,
  onCommand,
}: {
  commands: Command[];
  onCommand: (name: CommandName) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="composer-menu-anchor">
      <Tooltip text="More actions" describes={false}>
        <button
          type="button"
          ref={buttonRef}
          className="icon-button composer-more"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      {open && (
        <div
          className="composer-menu popover"
          role="menu"
          aria-label="More actions"
        >
          {commands.map((command) => (
            <button
              key={command.name}
              type="button"
              role="menuitem"
              className="option"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onCommand(command.name);
              }}
            >
              {ICONS[command.name]}
              <span className="composer-menu-label">{command.description}</span>
              <span className="composer-menu-command">/{command.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

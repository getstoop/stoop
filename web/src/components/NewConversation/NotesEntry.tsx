import { ChevronIcon, FileIcon } from "../Icons";

// The way to your own notes, the conversation with only you in it: a
// button of its own above the people, not a person to pick. You are in
// every conversation already, so a row for you among the checkboxes
// would read as someone to add.
export function NotesEntry({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="notes-entry"
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="notes-entry-icon">
        <FileIcon />
      </span>
      <span className="notes-entry-words">
        <strong>Your notes</strong>
        <span className="muted small">A conversation with only you in it</span>
      </span>
      <ChevronIcon />
    </button>
  );
}

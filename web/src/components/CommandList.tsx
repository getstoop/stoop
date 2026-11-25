import { useRef } from "react";
import type { Command } from "../core/commands";
import { useScrollToSelected } from "../hooks/useScrollToSelected";

// The slash commands a draft of "/" and letters matches, shown above the
// composer like the mention list. The row the keyboard is on is raised
// and carries an Enter keycap, so it does not rest on colour alone.
export function CommandList({
  commands,
  selected,
  onPick,
}: {
  commands: Command[];
  selected: number;
  onPick: (command: Command) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useScrollToSelected(listRef, selected);
  if (commands.length === 0) return null;
  return (
    <ul
      ref={listRef}
      className="mention-picker command-list popover"
      aria-label="Commands"
    >
      {commands.map((command, i) => (
        <li key={command.name}>
          <button
            type="button"
            className={`option command-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(command);
            }}
          >
            <span className="command-name">
              <span className="command-slash">/{command.name}</span>
              <span className="command-hint">{command.hint}</span>
            </span>
            <span className="muted small command-description">
              {command.description}
            </span>
            {i === selected && (
              <span className="command-key" aria-hidden="true">
                Enter
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

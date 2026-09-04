import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { initials } from "./Avatar";

// Autocomplete list shown above the composer while typing @handle.
export function MentionPicker({
  candidates,
  selected,
  onPick,
}: {
  candidates: Member[];
  selected: number;
  onPick: (m: Member) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul className="mention-picker" aria-label="Mention a member">
      {candidates.map((m, i) => (
        <li key={m.userId}>
          <button
            type="button"
            className={`mention-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(m);
            }}
          >
            <span className="avatar small">
              {initials(m.displayName || m.username)}
            </span>
            <span className="member-name">{m.displayName || m.username}</span>
            <span className="muted small">@{m.username}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

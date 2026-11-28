import { presenceClass, presenceLabel } from "../core/presence";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { useConnectionStore } from "../stores/connection";
import { Avatar } from "./Avatar";

export function CandidateRow({
  person,
  you = false,
  picked,
  disabled,
  onToggle,
}: {
  person: MessageAuthor;
  // The reader's own row: picking it is their notes.
  you?: boolean;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const online = useConnectionStore((s) => s.online.has(person.id));
  const dnd = useConnectionStore((s) => s.dnd[person.id]);
  const mobile = useConnectionStore((s) => s.mobile[person.id]);
  const name = person.displayName || person.username;
  return (
    <label className={`candidate-row ${disabled ? "disabled" : ""}`.trim()}>
      <input
        type="checkbox"
        checked={picked}
        disabled={disabled}
        onChange={onToggle}
      />
      <Avatar name={name} fileId={person.avatarFileId} size="small">
        <span
          className={`online-dot ${presenceClass(online, dnd, mobile)}`}
          role="img"
          aria-label={presenceLabel(online, dnd, mobile)}
        />
      </Avatar>
      <span className="candidate-name">{you ? `${name} (you)` : name}</span>
      {person.displayName && (
        <span className="muted small">@{person.username}</span>
      )}
    </label>
  );
}

import { presenceClass, presenceLabel } from "../../api/presence";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { useConnectionStore } from "../../stores/connection";
import { Avatar } from "../Avatar";

export function CandidateRow({
  person,
  picked,
  disabled,
  onToggle,
}: {
  person: MessageAuthor;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const online = useConnectionStore((s) => s.online.has(person.id));
  const dnd = useConnectionStore((s) => s.dnd[person.id]);
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
          className={`online-dot ${presenceClass(online, dnd)}`}
          role="img"
          aria-label={presenceLabel(online, dnd)}
        />
      </Avatar>
      <span className="candidate-name">{name}</span>
      {person.displayName && (
        <span className="muted small">@{person.username}</span>
      )}
    </label>
  );
}

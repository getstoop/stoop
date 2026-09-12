import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
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
  const name = person.displayName || person.username;
  return (
    <label className={`candidate-row ${disabled ? "disabled" : ""}`.trim()}>
      <input
        type="checkbox"
        checked={picked}
        disabled={disabled}
        onChange={onToggle}
      />
      <Avatar name={name} fileId={person.avatarFileId} size="small" />
      <span className="candidate-name">{name}</span>
      {person.displayName && (
        <span className="muted small">@{person.username}</span>
      )}
    </label>
  );
}

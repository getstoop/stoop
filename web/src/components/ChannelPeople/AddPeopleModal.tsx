import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addChannelPeople } from "../../api/channelPeople";
import { errorText } from "../../api/errors";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { Modal } from "../Modal";
import { CandidateRow } from "../NewConversation/CandidateRow";
import { filterCandidates } from "../NewConversation/candidates";

// Picking people to add to a private channel: the space's members who
// are not in it yet. The picker is the one a new conversation uses.
export function AddPeopleModal({
  channel,
  spaceName,
  candidates,
  onClose,
}: {
  channel: Channel;
  spaceName: string;
  // Members of the space who are not in the channel.
  candidates: Member[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = candidates.map(asAuthor);
  const shown = filterCandidates(people, query);
  const toggle = (id: string) =>
    setPicked((old) =>
      old.includes(id) ? old.filter((other) => other !== id) : [...old, id],
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await addChannelPeople(queryClient, channel.id, picked);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add people to ${channel.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={picked.length === 0 || busy}
            onClick={submit}
          >
            {picked.length > 1 ? `Add ${picked.length} people` : "Add"}
          </button>
        </>
      }
    >
      <div className="new-conversation">
        <p className="hint">
          People in {spaceName} who aren't in this channel. They can read
          everything already posted.
        </p>
        <input
          type="search"
          value={query}
          placeholder="Search people"
          aria-label="Search people"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="candidate-list">
          {shown.length === 0 && (
            <p className="muted small">
              {people.length === 0
                ? "Everyone in the space is already in this channel."
                : "No one matches that."}
            </p>
          )}
          {shown.map((person) => (
            <CandidateRow
              key={person.id}
              person={person}
              picked={picked.includes(person.id)}
              disabled={false}
              onToggle={() => toggle(person.id)}
            />
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// The picker's rows are drawn from a message author's fields.
const asAuthor = (member: Member): MessageAuthor =>
  ({
    id: member.userId,
    username: member.username,
    displayName: member.displayName,
    avatarFileId: member.avatarFileId,
    kind: member.kind,
  }) as MessageAuthor;

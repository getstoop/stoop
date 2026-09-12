import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  addDirectMessageMembers,
  createGroupDirectMessage,
  openDirectMessage,
  useDMCandidates,
} from "../../api/dms";
import { errorText } from "../../api/errors";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { notice } from "../../stores/dialogs";
import { Modal } from "../Modal";
import { CandidateRow } from "./CandidateRow";
import { filterCandidates } from "./candidates";

// The maximum a conversation holds, the caller included — the server's
// cap, mirrored so the picker can stop before the refusal.
const MAX_PARTICIPANTS = 10;

// Picking people, for the three moments that need it: starting a
// conversation, adding to a group, and bringing somebody into a 1:1 —
// which is not an add at all. A 1:1 is its two people, so a third means a
// new conversation with all of them, and the wording says so before the
// button is pressed.
export function NewConversation({
  group,
  carry = [],
  present = [],
  onClose,
}: {
  // The group being added to. Absent for the other two cases.
  group?: string;
  // People who come along into a new conversation: the other half of a
  // 1:1 that a third person is being brought into.
  carry?: string[];
  // Who is already in it, the caller included — hidden from the picker.
  present?: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: candidates, isLoading } = useDMCandidates();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MessageAuthor[]>([]);
  const [busy, setBusy] = useState(false);

  const shown = filterCandidates(candidates ?? [], query, present);
  // present holds the caller; with nothing to start from, it is just me.
  const full = picked.length >= MAX_PARTICIPANTS - (present.length || 1);

  const toggle = (person: MessageAuthor) =>
    setPicked((old) =>
      old.some((p) => p.id === person.id)
        ? old.filter((p) => p.id !== person.id)
        : [...old, person],
    );

  const submit = async () => {
    const ids = picked.map((p) => p.id);
    const others = [...carry, ...ids];
    setBusy(true);
    try {
      const id = group
        ? await addDirectMessageMembers(queryClient, group, ids)
        : others.length > 1
          ? await createGroupDirectMessage(queryClient, others)
          : await openDirectMessage(queryClient, others[0]);
      onClose();
      navigate({ to: "/dm/$channelId", params: { channelId: id } });
    } catch (err) {
      setBusy(false);
      notice({ title: "Couldn't start a conversation", body: errorText(err) });
    }
  };

  const starting = !group && carry.length + picked.length > 1;
  const action = group
    ? "Add to conversation"
    : starting
      ? "Start conversation"
      : "Message";

  return (
    <Modal
      title={group || carry.length ? "Add people" : "New conversation"}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="primary"
          disabled={picked.length === 0 || busy}
          onClick={submit}
        >
          {action}
        </button>
      }
    >
      <div className="new-conversation">
        {group && (
          <p className="muted small">
            Whoever you add can read everything said in this conversation.
          </p>
        )}
        {carry.length > 0 && (
          <p className="muted small">
            This starts a new conversation with everyone picked. Nothing already
            said here goes with it.
          </p>
        )}
        {picked.length > 0 && (
          <div className="picked-chips">
            {picked.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                aria-label={`Remove ${p.displayName || p.username}`}
                onClick={() => toggle(p)}
              >
                {p.displayName || p.username}
                <span aria-hidden="true">✕</span>
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          value={query}
          placeholder="Search people"
          aria-label="Search people"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="candidate-list">
          {isLoading && <p className="muted small">Loading…</p>}
          {!isLoading && shown.length === 0 && (
            <p className="muted small">
              {candidates?.length === 0
                ? "Nobody to message yet. People you share a space with show up here."
                : "No one matches that."}
            </p>
          )}
          {shown.map((person) => {
            const isPicked = picked.some((p) => p.id === person.id);
            return (
              <CandidateRow
                key={person.id}
                person={person}
                picked={isPicked}
                disabled={!isPicked && full}
                onToggle={() => toggle(person)}
              />
            );
          })}
        </div>
        {full && (
          <p className="muted small">
            A conversation holds {MAX_PARTICIPANTS} people. Make a space for
            anything bigger.
          </p>
        )}
      </div>
    </Modal>
  );
}

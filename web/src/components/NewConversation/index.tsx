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

// Picking people, for the two moments that need it: starting a
// conversation from the DM list, and adding to one that exists. The
// difference is `channel`, which also decides the wording.
export function NewConversation({
  channel,
  present = [],
  isPair = false,
  onClose,
}: {
  // The conversation being added to; absent when starting a new one.
  channel?: string;
  // Who is already in it, the caller included.
  present?: string[];
  // Adding to a 1:1 forks a new group rather than converting it, which
  // is worth saying before it happens.
  isPair?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: candidates, isLoading } = useDMCandidates();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MessageAuthor[]>([]);
  const [busy, setBusy] = useState(false);

  const shown = filterCandidates(candidates ?? [], query, present);
  const room = MAX_PARTICIPANTS - present.length - (channel ? 0 : 1);
  const full = picked.length >= room;

  const toggle = (person: MessageAuthor) =>
    setPicked((old) =>
      old.some((p) => p.id === person.id)
        ? old.filter((p) => p.id !== person.id)
        : [...old, person],
    );

  const submit = async () => {
    const ids = picked.map((p) => p.id);
    setBusy(true);
    try {
      const id = channel
        ? await addDirectMessageMembers(queryClient, channel, ids)
        : ids.length === 1
          ? await openDirectMessage(queryClient, ids[0])
          : await createGroupDirectMessage(queryClient, ids);
      onClose();
      navigate({ to: "/dm/$channelId", params: { channelId: id } });
    } catch (err) {
      setBusy(false);
      notice({ title: "Couldn't start a conversation", body: errorText(err) });
    }
  };

  const action = channel
    ? "Add to conversation"
    : picked.length > 1
      ? "Start conversation"
      : "Message";

  return (
    <Modal
      title={channel ? "Add people" : "New conversation"}
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
        {channel && (
          <p className="muted small">
            {isPair
              ? "This starts a new conversation with everyone picked. Nothing already said here goes with it."
              : "Whoever you add can read everything said in this conversation."}
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

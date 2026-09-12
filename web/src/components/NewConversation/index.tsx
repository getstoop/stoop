import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { openDirectMessage, useDMCandidates } from "../../api/dms";
import { errorText } from "../../api/errors";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { notice } from "../../stores/dialogs";
import { Modal } from "../Modal";
import { CandidateRow } from "./CandidateRow";
import { filterCandidates } from "./candidates";

// The maximum a conversation holds, the caller included — the server's
// cap, mirrored so the picker can stop before the refusal.
const MAX_PARTICIPANTS = 10;

// Picking who to talk to. One person or nine: a conversation is its
// people, so picking a set that already has a conversation opens that one
// rather than starting a second.
export function NewConversation({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: candidates, isLoading } = useDMCandidates();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MessageAuthor[]>([]);
  const [busy, setBusy] = useState(false);

  const shown = filterCandidates(candidates ?? [], query);
  const full = picked.length >= MAX_PARTICIPANTS - 1;

  const toggle = (person: MessageAuthor) =>
    setPicked((old) =>
      old.some((p) => p.id === person.id)
        ? old.filter((p) => p.id !== person.id)
        : [...old, person],
    );

  const submit = async () => {
    setBusy(true);
    try {
      const id = await openDirectMessage(
        queryClient,
        picked.map((p) => p.id),
      );
      onClose();
      navigate({ to: "/dm/$channelId", params: { channelId: id } });
    } catch (err) {
      setBusy(false);
      notice({ title: "Couldn't start a conversation", body: errorText(err) });
    }
  };

  return (
    <Modal
      title="New conversation"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="primary"
          disabled={picked.length === 0 || busy}
          onClick={submit}
        >
          {picked.length > 1 ? "Start conversation" : "Message"}
        </button>
      }
    >
      <div className="new-conversation">
        {picked.length > 1 && (
          <p className="muted small">
            Everyone picked is in it for good: nobody can be added later, and
            nobody can leave.
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

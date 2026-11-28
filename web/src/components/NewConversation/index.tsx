import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { openDirectMessage, useDMCandidates } from "../../api/dms";
import { errorText } from "../../api/errors";
import { useMe } from "../../api/queries";
import { filterCandidates } from "../../core/candidates";
import {
  type MessageAuthor,
  MessageAuthorSchema,
} from "../../gen/stoop/chat/v1/message_pb";
import { notice } from "../../stores/dialogs";
import { CandidateRow } from "../CandidateRow";
import { Modal } from "../Modal";

// The maximum a conversation holds, the caller included — the server's
// cap, mirrored so the picker can stop before the refusal.
const MAX_PARTICIPANTS = 10;

// Picking who to talk to. One person or nine: a conversation is its
// people, so picking a set that already has a conversation opens that one
// rather than starting a second. The reader heads the list: picked, alone,
// they are the conversation with nobody else in it, their own notes.
export function NewConversation({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: candidates, isLoading } = useDMCandidates();
  const { data: me } = useMe();
  const myId = me?.id;
  const self = useMemo(
    () =>
      me &&
      create(MessageAuthorSchema, {
        id: me.id,
        username: me.username,
        displayName: me.displayName,
        avatarFileId: me.avatarFileId,
      }),
    [me],
  );
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MessageAuthor[]>([]);
  const [busy, setBusy] = useState(false);

  const shown = filterCandidates(
    self ? [self, ...(candidates ?? [])] : (candidates ?? []),
    query,
  );
  const notes = picked.length === 1 && picked[0].id === myId;
  const full = !notes && picked.length >= MAX_PARTICIPANTS - 1;

  // The reader is in every conversation already, so picking them means
  // only them: it clears the others, and picking anyone else clears it.
  const toggle = (person: MessageAuthor) =>
    setPicked((old) => {
      if (old.some((p) => p.id === person.id))
        return old.filter((p) => p.id !== person.id);
      if (person.id === myId) return [person];
      return [...old.filter((p) => p.id !== myId), person];
    });

  const submit = async () => {
    setBusy(true);
    try {
      const id = await openDirectMessage(
        queryClient,
        picked.filter((p) => p.id !== myId).map((p) => p.id),
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
                {p.id === myId && " (you)"}
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
            <p className="muted small">No one matches that.</p>
          )}
          {shown.map((person) => {
            const isPicked = picked.some((p) => p.id === person.id);
            return (
              <CandidateRow
                key={person.id}
                person={person}
                you={person.id === myId}
                picked={isPicked}
                // Picking yourself clears the others, so it is never too many.
                disabled={!isPicked && full && person.id !== myId}
                onToggle={() => toggle(person)}
              />
            );
          })}
          {!isLoading && candidates?.length === 0 && (
            <p className="muted small">
              Nobody else to message yet. People you share a space with show up
              here.
            </p>
          )}
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

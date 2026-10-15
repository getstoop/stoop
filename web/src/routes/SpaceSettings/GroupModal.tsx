import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { filterCandidates } from "../../api/candidates";
import { GROUP_HANDLE_HINT, MAX_GROUP_NAME, saveGroup } from "../../api/groups";
import { isBot } from "../../api/identity";
import { CandidateRow } from "../../components/CandidateRow";
import { Field } from "../../components/Field";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import type { Group } from "../../gen/stoop/chat/v1/group_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// New group, or Edit with the group's fields filled in, from Space
// settings → Groups. The people are the space's members; bots can't be in
// a group.
export function GroupModal({
  spaceId,
  members,
  existing,
  onClose,
}: {
  spaceId: string;
  members: Member[];
  existing?: Group;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(existing?.name ?? "");
  const [handle, setHandle] = useState(existing?.handle ?? "");
  const [picked, setPicked] = useState<string[]>(existing?.userIds ?? []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["name", "handle", "userIds"]);

  const people = members.filter((member) => !isBot(member.kind)).map(asAuthor);
  const shown = filterCandidates(people, query);
  const toggle = (id: string) =>
    setPicked((old) =>
      old.includes(id) ? old.filter((other) => other !== id) : [...old, id],
    );
  const ready = name.trim() !== "" && handle.trim() !== "" && picked.length > 0;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    form.begin();
    try {
      await saveGroup(
        queryClient,
        spaceId,
        { name: name.trim(), handle: handle.trim(), userIds: picked },
        existing,
      );
      onClose();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : "New group"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !ready}
          >
            {existing ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-form group-form"
        onSubmit={save}
      >
        <Field label="Name" error={form.errors.name}>
          <input
            name="group-name"
            value={name}
            maxLength={MAX_GROUP_NAME}
            placeholder="Garden crew"
            onChange={(event) => setName(event.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field
          label="Handle"
          hint={GROUP_HANDLE_HINT}
          error={form.errors.handle}
        >
          <Input
            name="group-handle"
            start="@"
            value={handle}
            maxLength={32}
            placeholder="gardeners"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setHandle(event.target.value)}
          />
        </Field>
        <div className="new-conversation">
          <Field
            label="People"
            counter={`${picked.length} selected`}
            error={form.errors.userIds}
          >
            <input
              type="search"
              value={query}
              placeholder="Search people"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <div className="candidate-list">
            {shown.length === 0 && (
              <p className="muted small">No one matches that.</p>
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
        </div>
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
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

import { Code, ConnectError } from "@connectrpc/connect";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { createPoll } from "../../../api/polls";
import { Field } from "../../../components/Field";
import { Modal } from "../../../components/Modal";
import {
  checkPollForm,
  newPollForm,
  pollProblemText,
  pollRequest,
  withMultiple,
  withQuestion,
} from "../../../core/pollForm";
import { ChoiceControl } from "./ChoiceControl";
import { OptionFields } from "./OptionFields";

// Create a poll (docs/architecture/web.md → Polls): the question, one
// choice or several, two to ten options. Post is on only once the form
// is one the server takes (core/pollForm), and off while it is out: a
// poll has no idempotency key, so a second press would post twice. A
// refusal is said above the actions and leaves everything as typed.
export function PollForm({
  channelId,
  onClose,
  onPosted,
}: {
  channelId: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const formId = useId();
  const [form, setForm] = useState(newPollForm);
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const check = checkPollForm(form);

  const post = async (event?: FormEvent) => {
    event?.preventDefault();
    if (posting || !check.canPost) return;
    setPosting(true);
    setFailure(null);
    try {
      await createPoll(pollRequest(form, channelId));
    } catch (err) {
      setFailure(refusal(err));
      setPosting(false);
      return;
    }
    onPosted();
  };

  // Enter in the question goes on to the options; Cmd or Ctrl with Enter
  // posts from anywhere in the form.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void post();
    }
  };
  const onQuestionKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.currentTarget.form
      ?.querySelector<HTMLInputElement>(".poll-option-line input")
      ?.focus();
  };

  return (
    <Modal
      title="Create a poll"
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
            disabled={posting || !check.canPost}
            aria-busy={posting || undefined}
          >
            Post poll
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="modal-form poll-form"
        onSubmit={post}
        onKeyDown={onKeyDown}
      >
        <Field
          label="Question"
          error={check.question && pollProblemText(check.question, "question")}
        >
          <input
            name="poll-question"
            value={form.question}
            placeholder="Ask a question"
            autoComplete="off"
            onChange={(event) =>
              setForm((now) => withQuestion(now, event.target.value))
            }
            onKeyDown={onQuestionKey}
          />
        </Field>
        <ChoiceControl
          multiple={form.multiple}
          onChange={(multiple) => setForm((now) => withMultiple(now, multiple))}
        />
        <OptionFields form={form} problems={check.options} onChange={setForm} />
        {failure && (
          <p className="error poll-form-failure" role="alert">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}

// What a refusal says: the server's own words for a rule it holds (an
// announcement channel, a blocked conversation, a line it would not
// take), and "try again" for anything that may pass on a second try.
function refusal(err: unknown): string {
  const lead = "Couldn't post the poll.";
  if (!(err instanceof ConnectError) || !SAID_BY_SERVER.has(err.code)) {
    return `${lead} Try again.`;
  }
  const said = err.rawMessage.trim();
  if (!said) return `${lead} Try again.`;
  const sentence = said[0].toUpperCase() + said.slice(1);
  return `${lead} ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`;
}

const SAID_BY_SERVER = new Set([
  Code.InvalidArgument,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.NotFound,
]);

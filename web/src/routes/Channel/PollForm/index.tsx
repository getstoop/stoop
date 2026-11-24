import { Code, ConnectError } from "@connectrpc/connect";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { errorText } from "../../../api/errors";
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
import { notice } from "../../../stores/dialogs";
import { ChoiceControl } from "./ChoiceControl";
import { composing, keepFocusIn } from "./keys";
import { OptionFields } from "./OptionFields";

// Create a poll (docs/architecture/web.md → Polls): the question, one
// choice or several, two to ten options. Post is on only once the form
// is one the server takes (core/pollForm), and off while it is out: a
// poll has no idempotency key, so a second press would post twice. A
// refusal is said above the actions and leaves everything as typed.
// The poll goes to the channel the form was opened in, whatever the page
// shows by the time Post is pressed.
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
  const [channel] = useState(channelId);
  const [form, setForm] = useState(newPollForm);
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const check = checkPollForm(form);
  // The guard against a second post, set at once: state alone lets two
  // submits in one task both through.
  const postingRef = useRef(false);
  // Whether the form is still open when the answer comes.
  const open = useRef(true);
  useEffect(() => {
    // Set again on mount: StrictMode unmounts and mounts it once more.
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const post = async (event?: FormEvent) => {
    event?.preventDefault();
    if (postingRef.current || !check.canPost) return;
    postingRef.current = true;
    setPosting(true);
    setFailure(null);
    try {
      await createPoll(pollRequest(form, channel));
    } catch (err) {
      postingRef.current = false;
      // Closed meanwhile: the form is gone, so the refusal is a notice.
      if (!open.current) {
        notice({ title: "Couldn't post the poll", body: errorText(err) });
        return;
      }
      setFailure(refusal(err));
      setPosting(false);
      return;
    }
    if (open.current) onPosted();
  };

  // Cmd or Ctrl with Enter posts from anywhere in the dialog, its
  // actions included; Tab goes round the dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    keepFocusIn(event);
    if (event.key !== "Enter" || composing(event)) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void post();
    }
  };
  const onQuestionKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || composing(event)) return;
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.currentTarget.form
      ?.querySelector<HTMLInputElement>(".poll-option-line input")
      ?.focus();
  };

  return (
    // Holds the whole dialog, so Tab goes round it rather than out to
    // the page (the Modal has no trap of its own), and the shortcut
    // reaches the actions too.
    // biome-ignore lint/a11y/noStaticElementInteractions: keys for the dialog it holds
    <div className="poll-form-dialog" onKeyDown={onKeyDown}>
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
              {posting ? "Posting…" : "Post poll"}
            </button>
          </>
        }
      >
        <form id={formId} className="modal-form poll-form" onSubmit={post}>
          <Field
            label="Question"
            error={
              check.question && pollProblemText(check.question, "question")
            }
          >
            <input
              name="poll-question"
              value={form.question}
              placeholder="Ask a question"
              autoComplete="off"
              readOnly={posting}
              onChange={(event) =>
                setForm((now) => withQuestion(now, event.target.value))
              }
              onKeyDown={onQuestionKey}
            />
          </Field>
          <ChoiceControl
            multiple={form.multiple}
            disabled={posting}
            onChange={(multiple) =>
              setForm((now) => withMultiple(now, multiple))
            }
          />
          <OptionFields
            form={form}
            problems={check.options}
            locked={posting}
            onChange={setForm}
          />
          {failure && (
            <p className="error poll-form-failure" role="alert">
              {failure}
            </p>
          )}
        </form>
      </Modal>
    </div>
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

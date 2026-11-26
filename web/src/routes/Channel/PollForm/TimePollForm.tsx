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
import { composing, keepFocusIn } from "../../../components/dialogKeys";
import { Field } from "../../../components/Field";
import { Modal } from "../../../components/Modal";
import {
  pollProblemText,
  withMultiple,
  withQuestion,
} from "../../../core/pollForm";
import {
  checkTimePollForm,
  type TimePollForm as Form,
  newTimePollForm,
  timePollRequest,
} from "../../../core/timePollForm";
import { notice } from "../../../stores/dialogs";
import { ChoiceControl } from "./ChoiceControl";
import { refusal } from "./refusal";
import { TimeFields } from "./TimeFields";

// How often the form judges its times again while it is open, so a time
// that goes by meanwhile is said before Post is pressed.
const TICK_MS = 15_000;

// Find a time (docs/architecture/web.md → Polls): a poll whose options are
// times. The question, one time or several (several to start), and two to
// ten times, each picked with DateTimeField. Post is on only once the form
// is one the server takes by this device's clock (core/timePollForm), and
// off while it is out, as on the poll form. The times are sent as instants
// by this device's zone rules; the server judges them by its own clock,
// and its refusal is said above the actions. The poll goes to the channel
// the form was opened in.
export function TimePollForm({
  channelId,
  question = "",
  onClose,
  onPosted,
}: {
  channelId: string;
  // The question it opens with: the words typed after /when.
  question?: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const formId = useId();
  const [channel] = useState(channelId);
  const [form, setForm] = useState(() => newTimePollForm(question));
  // Opened with a question: the first time is where to go next.
  const [startsFilled] = useState(form.question !== "");
  const [now, setNow] = useState(() => new Date());
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const check = checkTimePollForm(form, now);
  // The guard against a second post, set at once: state alone lets two
  // submits in one task both through.
  const postingRef = useRef(false);
  // Whether the form is still open when the answer comes.
  const open = useRef(true);
  useEffect(() => {
    // Set again on mount: StrictMode unmounts and mounts it once more.
    open.current = true;
    const tick = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      open.current = false;
      window.clearInterval(tick);
    };
  }, []);

  const change = (next: (current: Form) => Form) => {
    setForm(next);
    setFailure(null);
    setNow(new Date());
  };

  const post = async (event?: FormEvent) => {
    event?.preventDefault();
    if (postingRef.current) return;
    // Judged again at this moment: a time may have gone by.
    const sentAt = new Date();
    setNow(sentAt);
    if (!checkTimePollForm(form, sentAt).canPost) return;
    postingRef.current = true;
    setPosting(true);
    setFailure(null);
    try {
      await createPoll(timePollRequest(form, channel));
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
  // actions included; Tab goes round the dialog. Not while a time's panel
  // is open: that Enter settles the panel's day or time, a change this
  // render's form does not hold yet, so posting then would send the time
  // as it was. The keystroke only settles and closes the panel.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    keepFocusIn(event);
    if (event.key !== "Enter" || composing(event)) return;
    if (event.currentTarget.querySelector(".date-time-panel")) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void post();
    }
  };
  // Enter in the question goes on to the first time.
  const onQuestionKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || composing(event)) return;
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.currentTarget.form
      ?.querySelector<HTMLButtonElement>(".date-time-field-button")
      ?.focus();
  };

  return (
    // Holds the whole dialog, so Tab goes round it rather than out to
    // the page (the Modal has no trap of its own), and the shortcut
    // reaches the actions too.
    // biome-ignore lint/a11y/noStaticElementInteractions: keys for the dialog it holds
    <div className="poll-form-dialog" onKeyDown={onKeyDown}>
      <Modal
        title="Find a time"
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
        <form
          id={formId}
          className="modal-form poll-form time-poll-form"
          onSubmit={post}
        >
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
              onChange={(event) => {
                const { value } = event.target;
                change((current) => withQuestion(current, value));
              }}
              onKeyDown={onQuestionKey}
            />
          </Field>
          <ChoiceControl
            noun="time"
            multiple={form.multiple}
            disabled={posting}
            onChange={(multiple) =>
              change((current) => withMultiple(current, multiple))
            }
          />
          <TimeFields
            form={form}
            now={now}
            problems={check.slots}
            locked={posting}
            focusFirst={startsFilled}
            onChange={(next) => change(() => next)}
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

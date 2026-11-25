import { Code, ConnectError } from "@connectrpc/connect";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { errorText } from "../../../api/errors";
import { createReminder, type SetReminder } from "../../../api/reminders";
import { composing, keepFocusIn } from "../../../components/dialogKeys";
import { Field } from "../../../components/Field";
import { Modal } from "../../../components/Modal";
import {
  checkReminderForm,
  newReminderForm,
  type ReminderRefusal,
  reminderRefusal,
  reminderRequest,
  reminderTextProblemText,
  reminderTimeProblemText,
  withChoice,
  withCustom,
  withText,
} from "../../../core/reminderForm";
import { notice } from "../../../stores/dialogs";
import { WhenField } from "./WhenField";

// How often the times the presets land on are worked out again while the
// form is open, so what they say keeps up with the clock.
const TICK_MS = 15_000;

// Set a reminder (docs/architecture/web.md → Reminders): the text and
// when. Set reminder is on only once the form is one the server takes
// (core/reminderForm), and off while it is out. A preset's time is worked
// out from the clock as it is sent. A refusal is said on the field it is
// about, or above the actions, and leaves everything as chosen. The
// reminder goes to the channel the form was opened in, whatever the page
// shows by then; onSet hears of it even if the form was closed meanwhile,
// so its notice and Undo are never lost.
export function ReminderForm({
  channelId,
  where,
  text = "",
  onClose,
  onSet,
}: {
  channelId: string;
  // The channel it posts in, as the subtitle names it; none for a
  // conversation.
  where: ReactNode;
  // The text it opens with: the words typed after /remind.
  text?: string;
  onClose: () => void;
  onSet: (set: SetReminder) => void;
}) {
  const formId = useId();
  const [channel] = useState(channelId);
  const [form, setForm] = useState(() => newReminderForm(text));
  const [now, setNow] = useState(() => new Date());
  const [setting, setSetting] = useState(false);
  const [failure, setFailure] = useState<ReminderRefusal | null>(null);
  const check = checkReminderForm(form, now);
  // The guard against a second request, set at once: state alone lets two
  // submits in one task both through.
  const settingRef = useRef(false);
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

  const change = (next: (current: typeof form) => typeof form) => {
    setForm(next);
    setFailure(null);
    setNow(new Date());
  };

  const set = async (event?: FormEvent) => {
    event?.preventDefault();
    if (settingRef.current) return;
    const sentAt = new Date();
    const request = reminderRequest(form, channel, sentAt);
    // Judged again at this moment: a picked time may have gone by.
    setNow(sentAt);
    if (!request) return;
    settingRef.current = true;
    setSetting(true);
    setFailure(null);
    let answer: SetReminder;
    try {
      answer = await createReminder(request);
    } catch (err) {
      settingRef.current = false;
      // Closed meanwhile: the form is gone, so the refusal is a notice.
      if (!open.current) {
        notice({ title: "Couldn't set the reminder", body: errorText(err) });
        return;
      }
      setFailure(reminderRefusal(saidByServer(err), form.choice !== "custom"));
      setSetting(false);
      return;
    }
    onSet(answer);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    keepFocusIn(event);
  };
  // Enter in the text sets it when it can; never while an input method
  // is composing.
  const onTextKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && composing(event)) event.preventDefault();
  };

  const textProblem =
    failure?.field === "text"
      ? failure.text
      : check.text && reminderTextProblemText(check.text);
  const whenProblem =
    failure?.field === "when"
      ? failure.text
      : check.when && reminderTimeProblemText(check.when);

  return (
    // Holds the whole dialog, so Tab goes round it rather than out to
    // the page (the Modal has no trap of its own).
    // biome-ignore lint/a11y/noStaticElementInteractions: keys for the dialog it holds
    <div className="reminder-form-dialog" onKeyDown={onKeyDown}>
      <Modal
        title="Set a reminder"
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
              disabled={setting || !check.canSet}
              aria-busy={setting || undefined}
            >
              {setting ? "Setting…" : "Set reminder"}
            </button>
          </>
        }
      >
        <form
          id={formId}
          className="modal-form reminder-form"
          onSubmit={set}
          noValidate
        >
          <p className="reminder-form-where">
            {where ? (
              <>Posts in {where} for everyone when the time comes.</>
            ) : (
              "Posts in this conversation when the time comes."
            )}
          </p>
          <Field label="Reminder" error={textProblem || null}>
            <input
              name="reminder-text"
              value={form.text}
              placeholder="What should everyone remember?"
              autoComplete="off"
              readOnly={setting}
              onChange={(event) =>
                change((current) => withText(current, event.target.value))
              }
              onKeyDown={onTextKey}
            />
          </Field>
          <WhenField
            form={form}
            now={now}
            problem={whenProblem || null}
            locked={setting}
            onChoice={(choice) =>
              change((current) => withChoice(current, choice))
            }
            onCustom={(value) =>
              change((current) => withCustom(current, value))
            }
          />
          {failure && failure.field === null && (
            <p className="error reminder-form-failure" role="alert">
              {failure.text}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

// The server's own words, for a refusal that is a rule it holds (a line
// or a time it would not take, the cap, a channel the person can't post
// in); null for anything that may pass on a second try.
function saidByServer(err: unknown): string | null {
  return err instanceof ConnectError && SAID_BY_SERVER.has(err.code)
    ? err.rawMessage
    : null;
}

const SAID_BY_SERVER = new Set([
  Code.InvalidArgument,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.NotFound,
  Code.ResourceExhausted,
]);

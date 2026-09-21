import { type FormEvent, useId, useState } from "react";
import { errorText } from "../api/errors";
import {
  type ConfirmOptions,
  type NoticeOptions,
  type PromptOptions,
  useDialogStore,
} from "../stores/dialogs";
import { Field } from "./Field";
import { Modal } from "./Modal";

// Renders the head of the dialog queue (stores/dialogs.ts). Mounted once,
// at the root route, so a dialog can be raised from anywhere.
export function DialogHost() {
  const request = useDialogStore((s) => s.queue[0]);
  const shift = useDialogStore((s) => s.shift);
  if (!request) return null;
  // Keyed on the request so a new one remounts with fresh state.
  const key = useDialogStore.getState().queue.length + request.opts.title;
  switch (request.kind) {
    case "confirm":
      return (
        <ConfirmDialog
          key={key}
          opts={request.opts}
          onDone={(ok) => {
            shift();
            request.resolve(ok);
          }}
        />
      );
    case "prompt":
      return (
        <PromptDialog
          key={key}
          opts={request.opts}
          onDone={(value) => {
            shift();
            request.resolve(value);
          }}
        />
      );
    case "notice":
      return (
        <NoticeDialog
          key={key}
          opts={request.opts}
          onDone={() => {
            shift();
            request.resolve();
          }}
        />
      );
  }
}

function ConfirmDialog({
  opts,
  onDone,
}: {
  opts: ConfirmOptions;
  onDone: (ok: boolean) => void;
}) {
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(false)}
      small
      kind="confirm"
      footer={
        <>
          <button
            type="button"
            className="chip"
            onClick={() => onDone(false)}
            // Enter on a destructive confirm should not destroy anything.
            // biome-ignore lint/a11y/noAutofocus: a dialog is meant to take focus
            autoFocus={opts.danger}
          >
            {opts.cancel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`primary ${opts.danger ? "danger" : ""}`}
            onClick={() => onDone(true)}
            // biome-ignore lint/a11y/noAutofocus: a dialog is meant to take focus
            autoFocus={!opts.danger}
          >
            {opts.action ?? "OK"}
          </button>
        </>
      }
    >
      {opts.body && <p className="modal-body">{opts.body}</p>}
    </Modal>
  );
}

function PromptDialog({
  opts,
  onDone,
}: {
  opts: PromptOptions;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(opts.initial ?? "");
  const fieldId = useId();
  const trimmed = value.trim();
  const ready =
    opts.match !== undefined
      ? trimmed === opts.match
      : opts.allowEmpty || trimmed !== "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async () => {
    if (!ready || busy) return;
    if (!opts.submit) return onDone(trimmed);
    setBusy(true);
    setError(null);
    try {
      await opts.submit(trimmed);
      onDone(trimmed);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      document.getElementById(fieldId)?.focus();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void answer();
  };
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      small
      kind="prompt"
      footer={
        <>
          <button type="button" className="chip" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="submit"
            form="prompt-dialog"
            className={`primary ${opts.danger ? "danger" : ""}`}
            disabled={!ready || busy}
          >
            {opts.action ?? "OK"}
          </button>
        </>
      }
    >
      <form id="prompt-dialog" className="modal-form" onSubmit={submit}>
        {opts.body && <p className="modal-body">{opts.body}</p>}
        <Field
          label={opts.label ?? opts.title}
          counter={
            opts.maxLength !== undefined
              ? `${value.length} / ${opts.maxLength}`
              : undefined
          }
          error={error}
        >
          {opts.multiline ? (
            <textarea
              id={fieldId}
              value={value}
              rows={3}
              maxLength={opts.maxLength}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              // Enter submits, as it does in the one-line prompt; a topic
              // is one line, so there is no newline to type.
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void answer();
                }
              }}
            />
          ) : (
            <input
              id={fieldId}
              type="text"
              value={value}
              maxLength={opts.maxLength}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function NoticeDialog({
  opts,
  onDone,
}: {
  opts: NoticeOptions;
  onDone: () => void;
}) {
  return (
    <Modal
      title={opts.title}
      onClose={onDone}
      small
      kind="notice"
      footer={
        <button type="button" className="primary" onClick={onDone}>
          OK
        </button>
      }
    >
      {opts.body && <p className="modal-body">{opts.body}</p>}
    </Modal>
  );
}

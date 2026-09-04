import { type FormEvent, useId, useState } from "react";
import {
  type ConfirmOptions,
  type NoticeOptions,
  type PromptOptions,
  useDialogStore,
} from "../stores/dialogs";
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onDone(trimmed);
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
            disabled={!ready}
          >
            {opts.action ?? "OK"}
          </button>
        </>
      }
    >
      <form id="prompt-dialog" className="modal-form" onSubmit={submit}>
        {opts.body && <p className="modal-body">{opts.body}</p>}
        <label className="field" htmlFor={fieldId}>
          <span className="field-label-row">
            {opts.label ?? opts.title}
            {opts.maxLength !== undefined && (
              <span className="muted small">
                {value.length} / {opts.maxLength}
              </span>
            )}
          </span>
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
                  if (ready) onDone(trimmed);
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
        </label>
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

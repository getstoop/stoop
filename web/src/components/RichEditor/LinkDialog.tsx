import { type FormEvent, useId, useState } from "react";
import { createPortal } from "react-dom";
import { checkLink } from "../../core/editor/links";
import { Field } from "../Field";
import { Input } from "../Input";
import { Modal } from "../Modal";

// The link form: the words and the address. On the body, not in the
// composer, whose own form it would otherwise sit inside.
export function LinkDialog({
  text: initialText,
  href: initialHref,
  editing,
  onSave,
  onRemove,
  onCancel,
}: {
  text: string;
  href: string;
  editing: boolean;
  onSave: (text: string, href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);
  const [errors, setErrors] = useState<{ text?: string; href?: string }>({});

  const save = (e: FormEvent) => {
    e.preventDefault();
    // React carries the submit up to the composer's form.
    e.stopPropagation();
    const found = checkLink(text, href);
    setErrors(found);
    if (!found.text && !found.href) onSave(text, href);
  };

  return createPortal(
    <Modal
      title={editing ? "Edit link" : "Add link"}
      onClose={onCancel}
      small
      footer={
        <>
          {/* Editing, ✕ and Escape still cancel. */}
          {editing ? (
            <button type="button" className="chip danger" onClick={onRemove}>
              Remove link
            </button>
          ) : (
            <button type="button" className="chip" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" form={formId} className="primary">
            Save
          </button>
        </>
      }
    >
      <form id={formId} className="modal-form" onSubmit={save}>
        <Field label="Text" error={errors.text}>
          <Input
            value={text}
            autoFocus={!initialText}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label="Address" error={errors.href}>
          <Input
            value={href}
            autoFocus={!!initialText}
            placeholder="https://"
            onChange={(e) => setHref(e.target.value)}
          />
        </Field>
      </form>
    </Modal>,
    document.body,
  );
}

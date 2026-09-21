import { useEffect, useRef, useState } from "react";
import { errorText, fieldError } from "../api/errors";

// A form's refusals, held by the field they are about. Anything that
// belongs to no field is formError, the line above the buttons. See
// docs/architecture/design-system.md → Feedback.
export function useFieldErrors<F extends string>(
  fields: readonly F[],
  // For a form that edits one item of a list: what the server's path has
  // in front of this form's fields, such as /^providers\[\d+\]\./.
  opts: { strip?: RegExp } = {},
) {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // After a refusal, focus goes to the first field it landed on.
  // A field that is not on screen (a collapsed section) has nowhere to show
  // it, so the refusal moves to the form's own line rather than vanish.
  useEffect(() => {
    if (failures === 0 || !formRef.current) return;
    const invalid = formRef.current.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    if (invalid) return invalid.focus();
    setErrors((held) => {
      const [first] = Object.values<string | undefined>(held);
      if (first) setFormError(first);
      return {};
    });
  }, [failures]);

  const set = (field: F, message: string) => {
    setErrors((e) => ({ ...e, [field]: message }));
    setFailures((n) => n + 1);
  };

  return {
    errors,
    formError,
    formRef,
    // Clears everything; call it at the top of a submit.
    begin() {
      setErrors({});
      setFormError(null);
    },
    // A client-side check that names its field.
    set,
    // A refused submit. It goes on the field the server named when this
    // form has it; a form with one field owns every refusal.
    fail(err: unknown) {
      const path = fieldError(err)?.field;
      const named = (opts.strip ? path?.replace(opts.strip, "") : path) as
        | F
        | undefined;
      const field =
        named && fields.includes(named)
          ? named
          : fields.length === 1
            ? fields[0]
            : undefined;
      if (field) set(field, errorText(err));
      else setFormError(errorText(err));
    },
  };
}

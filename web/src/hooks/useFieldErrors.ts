import { useEffect, useRef, useState } from "react";
import { errorText } from "../api/errors";

// A form's refusals, held by the field they are about. Anything that
// belongs to no field is formError, the line above the buttons. See
// docs/architecture/design-system.md → Feedback.
export function useFieldErrors<F extends string>(fields: readonly F[]) {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // After a refusal, focus goes to the first field it landed on.
  useEffect(() => {
    if (failures === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
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
    // A refused submit. A form with one field owns every refusal.
    fail(err: unknown) {
      const only = fields.length === 1 ? fields[0] : undefined;
      if (only) set(only, errorText(err));
      else setFormError(errorText(err));
    },
  };
}

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText, fieldError } from "../../api/errors";
import { useEmailSettings } from "../../api/queries";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import {
  EMAIL_FIELDS,
  EMPTY,
  type EmailField,
  type EmailFields,
  fieldsFrom,
  isDirty,
  normalize,
  numberErrors,
  portAfterSecurity,
  type SetEmailField,
  settingsFrom,
} from "./fields";

// The email settings being edited: seeded from the server, saved, and
// tried with a test send. The admin tab and the setup step each hold one.
export function useEmailDraft() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useEmailSettings();
  const [fields, setFields] = useState<EmailFields>(EMPTY);
  const [baseline, setBaseline] = useState<EmailFields>(EMPTY);
  const [password, setPassword] = useState("");
  const [to, setTo] = useState("");
  const form = useFieldErrors(EMAIL_FIELDS);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const seeded = useRef<string | null>(null);

  const set: SetEmailField = (key, value) =>
    setFields((f) => ({ ...f, [key]: value }));

  const setSecurity = (security: EmailFields["security"]) =>
    setFields((f) => ({
      ...f,
      security,
      port: portAfterSecurity(f.port, f.security, security),
    }));

  const dirty = isDirty(fields, baseline, password);

  // Seeds from what is saved, never on top of unsaved edits.
  useEffect(() => {
    if (!data) return;
    const next = fieldsFrom(data.smtp);
    const sig = JSON.stringify(next);
    if (sig === seeded.current) return;
    if (seeded.current !== null && dirty) return;
    seeded.current = sig;
    setFields(next);
    setBaseline(next);
  }, [data, dirty]);

  // A box with no number in it is refused here, under its field.
  const checkNumbers = (): boolean => {
    const errors = Object.entries(numberErrors(fields));
    for (const [field, message] of errors) {
      form.set(field as EmailField, message);
    }
    return errors.length === 0;
  };

  // True when saved (or there was nothing to save); a refusal lands on
  // its field and gives false.
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    form.begin();
    if (!checkNumbers()) return false;
    setBusy(true);
    try {
      await instanceClient.updateEmailSettings({
        smtp: settingsFrom(fields, password),
      });
      setBaseline(normalize(fields));
      setPassword("");
      seeded.current = null;
      await queryClient.invalidateQueries({ queryKey: ["email-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
      return true;
    } catch (err) {
      form.fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Sends one message with what the form holds, saved or not. A refusal
  // about a field lands on it; anything else stays with the test row.
  const sendTest = async () => {
    form.begin();
    setAcceptedBy(null);
    setTestError(null);
    if (!checkNumbers()) return;
    setTesting(true);
    try {
      const res = await instanceClient.sendTestEmail({
        smtp: settingsFrom(fields, password),
        to: to.trim(),
      });
      setAcceptedBy(res.acceptedBy || normalize(fields).host);
    } catch (err) {
      const field = fieldError(err)?.field;
      if (field && (EMAIL_FIELDS as readonly string[]).includes(field)) {
        form.fail(err);
      } else {
        setTestError(errorText(err));
      }
    } finally {
      setTesting(false);
    }
  };

  return {
    data,
    isLoading,
    fields,
    set,
    setSecurity,
    password,
    setPassword,
    hasPassword: data?.smtp?.hasPassword ?? false,
    form,
    dirty,
    busy,
    save,
    test: { to, setTo, testing, acceptedBy, testError, send: sendTest },
  };
}

export type EmailDraft = ReturnType<typeof useEmailDraft>;

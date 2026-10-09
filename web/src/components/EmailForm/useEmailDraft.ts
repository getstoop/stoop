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
  const { data, isLoading, error } = useEmailSettings();
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

  // A test's outcome describes the settings it was sent with; any change
  // makes it stale.
  const clearTest = () => {
    setAcceptedBy(null);
    setTestError(null);
  };

  const set: SetEmailField = (key, value) => {
    clearTest();
    setFields((f) => ({ ...f, [key]: value }));
  };

  const setSecurity = (security: EmailFields["security"]) => {
    clearTest();
    setFields((f) => ({
      ...f,
      security,
      port: portAfterSecurity(f.port, f.security, security),
    }));
  };

  const changePassword = (value: string) => {
    clearTest();
    setPassword(value);
  };

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
  // its field and gives false. `changes` are applied first, for a caller
  // that sets a field and saves in one go (the setup step turns email on).
  const save = async (changes?: Partial<EmailFields>): Promise<boolean> => {
    const next = { ...fields, ...changes };
    if (!isDirty(next, baseline, password)) return true;
    form.begin();
    if (!checkNumbers()) return false;
    setBusy(true);
    try {
      const res = await instanceClient.updateEmailSettings({
        smtp: settingsFrom(next, password),
      });
      // The reply is what is saved now: seed from it and put it in the
      // cache, so no refetch can bring the old settings back.
      const saved = fieldsFrom(res.smtp);
      seeded.current = JSON.stringify(saved);
      setFields(saved);
      setBaseline(saved);
      setPassword("");
      queryClient.setQueryData(["email-settings"], (old: typeof data) =>
        old ? { ...old, smtp: res.smtp } : old,
      );
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
    loadError: error ? errorText(error) : null,
    fields,
    set,
    setSecurity,
    password,
    setPassword: changePassword,
    hasPassword: data?.smtp?.hasPassword ?? false,
    form,
    dirty,
    busy,
    save,
    test: { to, setTo, testing, acceptedBy, testError, send: sendTest },
  };
}

export type EmailDraft = ReturnType<typeof useEmailDraft>;

import { type FormEvent, useState } from "react";
import { SmtpFields } from "../../components/EmailForm/SmtpFields";
import { TestEmailRow } from "../../components/EmailForm/TestEmailRow";
import { useEmailDraft } from "../../components/EmailForm/useEmailDraft";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";

// The SMTP server Stoop sends mail through. The fields are shared with
// the setup wizard's Email step.
export function EmailSection() {
  const draft = useEmailDraft();
  const { data, isLoading, loadError, fields, set, form, dirty, busy, save } =
    draft;
  const [saved, setSaved] = useState(false);
  const savedHost = data?.smtp?.host ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (await save()) setSaved(true);
  };

  return (
    <section className="card email-section">
      <h3>Email</h3>
      <p className="hint">
        The SMTP server Stoop sends mail through. Any provider's SMTP relay
        works, or one you run.
      </p>
      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : loadError ? (
        // No form: one built on defaults could save them over the server.
        <p className="error" role="alert">
          Could not read the email settings: {loadError}
        </p>
      ) : (
        <form className="email-form" ref={form.formRef} onSubmit={submit}>
          <fieldset className="email-fieldset" disabled={busy}>
            {savedHost === "" && (
              <p className="hint">
                Nothing in Stoop sends email until a host is saved here.
              </p>
            )}
            <SettingRow
              id="email-enabled"
              title="Send email"
              description="Off keeps the settings and sends nothing."
            >
              <Switch
                id="email-enabled"
                checked={fields.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
            </SettingRow>

            <SmtpFields draft={draft} />

            {form.formError && (
              <p className="error" role="alert">
                {form.formError}
              </p>
            )}
            <div className="setting-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || !dirty}
              >
                Save
              </button>
              {saved && !dirty && <span className="hint">Saved.</span>}
            </div>

            <TestEmailRow draft={draft} />
          </fieldset>
        </form>
      )}
    </section>
  );
}

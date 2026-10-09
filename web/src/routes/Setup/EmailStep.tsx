import type { FormEvent } from "react";
import { SmtpFields } from "../../components/EmailForm/SmtpFields";
import { TestEmailRow } from "../../components/EmailForm/TestEmailRow";
import { useEmailDraft } from "../../components/EmailForm/useEmailDraft";
import { WizardActions } from "./WizardActions";

// The SMTP server Stoop sends through. Continue saves it turned on.
export function EmailStep({
  onDone,
  onBack,
  onLater,
}: {
  onDone: () => void;
  onBack?: () => void;
  onLater: () => void;
}) {
  const draft = useEmailDraft();
  const { form } = draft;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.fields.host.trim() === "") {
      form.begin();
      form.set("smtp.host", "Enter a host, or set this up later.");
      return;
    }
    if (await draft.save({ enabled: true })) onDone();
  };

  if (draft.isLoading) return <p className="muted">Loading…</p>;
  // No form: one built on defaults could save them over the server.
  if (draft.loadError) {
    return (
      <div className="login-card bare">
        <p className="error" role="alert">
          Could not read the email settings: {draft.loadError}
        </p>
        <WizardActions label="Set up later" onBack={onBack} onNext={onLater} />
      </div>
    );
  }

  return (
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>Can Stoop send email?</strong>
      </p>
      <p className="hint">
        Any SMTP server works: a mail provider's relay, or one you run. Without
        one, an admin resets forgotten passwords.
      </p>
      <fieldset className="email-fieldset" disabled={draft.busy}>
        <SmtpFields
          draft={draft}
          headings={false}
          fromName={false}
          hourlyLimit={false}
        />
        <TestEmailRow draft={draft} headings={false} label="Send a test to" />
      </fieldset>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <WizardActions
        label="Continue"
        busy={draft.busy}
        onBack={onBack}
        onLater={onLater}
      />
    </form>
  );
}

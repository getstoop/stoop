import { Field } from "../Field";
import { controlAttrs } from "../fieldControl";
import { EmailGroup } from "./EmailGroup";
import { canTest } from "./fields";
import type { EmailDraft } from "./useEmailDraft";

// Sends one message with what the form holds, saved or not. Shown once
// there is a host to send through.
export function TestEmailRow({
  draft,
  headings = true,
  label = "Send to",
}: {
  draft: EmailDraft;
  headings?: boolean;
  label?: string;
}) {
  const { to, setTo, testing, acceptedBy, testError, send } = draft.test;
  if (!canTest(draft.fields)) return null;
  return (
    <EmailGroup
      headings={headings}
      title="Test email"
      description="Sends one message with the settings above, saved or not."
    >
      <Field label={label} error={draft.form.errors.to}>
        {(control) => (
          <div className="card-row">
            <input
              {...controlAttrs(control)}
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              // Enter tries the test, not the form's own submit.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (to.trim() !== "" && !testing) send();
              }}
              placeholder="casey@example.com"
            />
            <button
              type="button"
              className="chip"
              disabled={testing || to.trim() === ""}
              onClick={send}
            >
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
        )}
      </Field>
      {acceptedBy && (
        <p className="hint" role="status">
          Accepted by {acceptedBy}. Check the inbox and spam.
        </p>
      )}
      {testError && (
        <p className="error" role="alert">
          {testError}
        </p>
      )}
    </EmailGroup>
  );
}

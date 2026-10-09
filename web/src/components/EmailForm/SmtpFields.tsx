import { Field } from "../Field";
import { NumberInput } from "../NumberInput";
import { EmailGroup } from "./EmailGroup";
import { SECURITY_OPTIONS } from "./fields";
import type { EmailDraft } from "./useEmailDraft";

// The SMTP server's fields. The setup step leaves out From name and the
// hourly limit; the draft still sends the saved values for both.
export function SmtpFields({
  draft,
  headings = true,
  fromName = true,
  hourlyLimit = true,
}: {
  draft: EmailDraft;
  headings?: boolean;
  fromName?: boolean;
  hourlyLimit?: boolean;
}) {
  const { fields, set, setSecurity, password, setPassword, hasPassword } =
    draft;
  const errors = draft.form.errors;
  // The saved password is kept only for the server and account it was
  // saved for; past either change the server asks for it again.
  const saved = draft.data?.smtp;
  const keepsPassword =
    hasPassword &&
    fields.username.trim() !== "" &&
    fields.host.trim() === saved?.host &&
    fields.username.trim() === saved?.username;
  return (
    <>
      <EmailGroup
        headings={headings}
        title="Server"
        description="Where to connect, and how the connection is encrypted."
      >
        <Field label="Host" error={errors["smtp.host"]}>
          <input
            value={fields.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="smtp.example.net"
            autoComplete="off"
          />
        </Field>
        <div className="field-pair">
          <Field label="Security" error={errors["smtp.security"]}>
            <select
              value={fields.security}
              onChange={(e) => setSecurity(Number(e.target.value))}
            >
              {SECURITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Port"
            hint="587 for STARTTLS, 465 for TLS."
            error={errors["smtp.port"]}
          >
            <input
              value={fields.port}
              onChange={(e) => set("port", e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
        </div>
      </EmailGroup>

      <EmailGroup
        headings={headings}
        title="Sign-in"
        description="Leave both blank for a relay that takes mail without one."
      >
        <Field label="Username" error={errors["smtp.username"]}>
          <input
            value={fields.username}
            onChange={(e) => set("username", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Password" error={errors["smtp.password"]}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={keepsPassword ? "(saved — leave blank to keep)" : ""}
            autoComplete="new-password"
          />
        </Field>
      </EmailGroup>

      <EmailGroup
        headings={headings}
        title="Sender"
        description="Who the mail says it is from. Most providers only accept an address they've verified."
      >
        <Field label="From address" error={errors["smtp.fromAddress"]}>
          <input
            type="email"
            value={fields.fromAddress}
            onChange={(e) => set("fromAddress", e.target.value)}
            placeholder="stoop@example.net"
          />
        </Field>
        {fromName && (
          <Field
            label="From name"
            hint="Blank uses the instance name."
            error={errors["smtp.fromName"]}
          >
            <input
              value={fields.fromName}
              onChange={(e) => set("fromName", e.target.value)}
            />
          </Field>
        )}
      </EmailGroup>

      {hourlyLimit && (
        <EmailGroup
          headings={headings}
          title="Hourly limit"
          description="Every email counts, tests included."
        >
          <Field
            label="Emails an hour"
            hint="0 sends without a cap."
            error={errors["smtp.hourlyLimit"]}
          >
            <NumberInput
              min="0"
              max="100000"
              step="1"
              value={fields.hourlyLimit}
              onChange={(e) => set("hourlyLimit", e.target.value)}
            />
          </Field>
        </EmailGroup>
      )}
    </>
  );
}

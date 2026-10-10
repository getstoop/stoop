# Email

Stoop sends mail through one SMTP server an instance admin chooses. It is
optional: with none set up, nothing changes. Today it sends the test
email and the account-address confirmations and notices; password reset
and invites will build on the same job. The operator's view is
[../self-hosting/email.md](../self-hosting/email.md).

## Settings

One settings row, `smtp` (`internal/instance/email.go`): enabled, host,
port, security (`starttls`, `tls`, `none`), username, password, from
address, from name, hourly limit. Seeded once from `STOOP_SMTP_*` like the
other environment-backed settings ([runtime.md](runtime.md)); after that
the row is the setting.

- The password is write-only: `GetEmailSettings` returns `has_password`.
  A blank password on a save or a test keeps the saved one only while the
  host and username are unchanged; changing either needs it typed again,
  so a test can't hand the saved password to another server.
- `none` with a username is refused: a password is never sent unencrypted.
- A port of 0 takes the mode's default (587, 465, 25).
- A blank from name sends the instance name.
- Every field is checked before anything is written; a refusal names its
  field (`smtp.host`, …) as a `FieldViolation`
  ([contracts.md](contracts.md)).
- `email_enabled` on `GetInstanceStatus` is "turned on with a host saved";
  a feature that sends mail hides itself when it is false.

## Sending

`internal/mail` is a support package that knows nothing of settings:
`Deliver(ctx, Server, Message)` makes one connection with
`github.com/wneessen/go-mail` and returns a `*mail.Refusal` naming the
setting that explains a failure. `instance.Service` implements
`mail.Sender`: it reads the row, takes a slot under the hourly cap,
delivers, and records the outcome.

- `starttls` is mandatory STARTTLS: a server that doesn't offer it is an
  error, never a fall back to plain text. `tls` is implicit TLS.
  Certificates are always verified; there is no custom CA.
- 10 s to connect, 30 s for the whole send.
- Headers: From with the name, Date, a Message-ID on the sender's domain,
  `Auto-Submitted: auto-generated`.
- Logs carry host, port, recipient domain and reply code, never the
  password.

## The hourly cap

`hourly_limit` (default 100, 0 for none) counts every send, test or real,
in one settings row, `smtp_send_window` (`start`, `count`), bumped by a
single upsert, so it holds across processes. A send refused by the cap is
not counted and returns `*mail.HourlyLimitError` with the window's end.

## The test send

`SendTestEmail` (admins, 5 a minute per account) sends with the settings in
the request, saved or not, so a change can be tried before it is saved. It
is synchronous and not a job. Refusals land on the field that explains
them: the host for DNS and certificate failures, the port for a connection
nobody answers, security for a TLS mismatch, the password for a rejected
sign-in, the from address for a refused sender, `to` for a refused
recipient or the cap. Anything else is the server's reply, as sent. The
host is the admin's choice, so it is not passed through `netguard`.

## The last send

`smtp_last_send` (`at`, `ok`, `error`) is written after every attempt. The
`email` health row reads it ([diagnostics.md](diagnostics.md)) and never
dials the server: a sign-in on every refresh could trip a provider's
limits.

## The send_email job

Everything except the test goes out through one job kind, `send_email`
(`internal/app/email_jobs.go`). Its arguments name the message and who it
is for (`mail.JobArgs`: `template`, `user_id`, `old_address`, `at`), never the
finished email: a link's token is made when the job runs, so it is never
stored with the job.

| Template | Built by | Sends |
| --- | --- | --- |
| `confirm_email` | auth | a link to confirm the pending address |
| `email_changed` | auth | a notice to the old address after a change or removal, with when (`at`; a job without it says the send time) |

The job looks up the template's `mail.Builder`, runs it with the public URL
and instance name, and sends through the instance's capped sender. A
builder may set `Message.OnSent`, which runs only once the server has
accepted the message; confirmation uses it to retire older links, so a
send that fails leaves the link already delivered working.

| Outcome | Job |
| --- | --- |
| Sent, or `mail.ErrNothingToSend` | done |
| Connection failed, 4xx reply, other errors | retry: 1 min, 5 min, 30 min; 5 attempts |
| Hourly cap | retry at the window's end (counts as an attempt) |
| 5xx reply, email off, no public URL, unknown template | discard |

At most two run at once across all email. A confirmation held behind the
cap for five windows is discarded; the person presses Resend.

A new message is a template (below), a builder in the module that owns
its content, and one line in the job's builder map. It keeps to the same
rules: arguments are ids, never content, and anything secret is made by
the builder.

## Templates

Every message, the test included, is rendered by `mail.Render(name, data,
site)` from `internal/mail/templates/` (embedded): it returns the subject,
text and HTML, and the caller sets `To` and `OnSent`.

- `layout.txt.tmpl` and `layout.html.tmpl` hold the instance name, the
  card and the footer. Each message has `<name>.txt.tmpl` (defines
  `subject` and `body`) and `<name>.html.tmpl` (defines `body`); either
  may define `footer` to replace the default second sentence.
- A message renders only with its own data struct (`mail.ConfirmEmailData`,
  …, listed in `internal/mail/message_data.go`); anything else, or a
  field the template doesn't find, is an error.
- To add one: the two template files, a data struct and its line in
  `messageData`, a name constant, the builder, and its line in the job's
  map.
- HTML goes through `html/template`, so every value is escaped; text
  through `text/template`, as typed. The subject is folded to one line.
- The HTML is table-based with inline light colours and a
  `prefers-color-scheme: dark` block. No images, no remote assets, no
  tracking: the only URLs are the links themselves, and a button's link
  is also printed in full.
- Golden files in `internal/mail/testdata/` hold each message as sent;
  after changing a template, `go test ./internal/mail/... -update` and
  read the diff.

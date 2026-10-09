# Email

Stoop sends mail through one SMTP server an instance admin chooses. It is
optional: with none set up, nothing changes. Nothing sends mail yet; the
features that will (password reset, address verification, invites) build on
what is here. The operator's view is
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

## For features that send mail

- Send through a job, never inline in a request: a slow or down server
  must not hold up a sign-in or a reset form.
- Job arguments name a template and its inputs, never the rendered body:
  a reset link holds a secret, and finished jobs stay in the table.
- Retry connection failures, 4xx replies and the cap; discard 5xx replies.

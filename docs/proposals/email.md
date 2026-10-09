# Email: SMTP setup and sending

Status: accepted 2026-10-09, being built (epic in Plane: "SMTP email").
Screens: https://claude.ai/artifact/QNDyLS4m7cZX6muYHFaKE8

An instance admin connects Stoop to an SMTP server, checks it with a test
email, and from then on Stoop can send mail. Nothing sends mail yet:
password reset, address verification, second factors and invites come
later and build on this.

## Scope

In:

- SMTP settings on a new **Email** admin tab and an optional Email step in
  first-run setup, seeded once from `STOOP_SMTP_*`, editable with
  `stoop admin`.
- Password sign-in to the SMTP server over STARTTLS or TLS; no sign-in for
  a local relay.
- A test email that uses the form's values, saved or not, and puts any
  refusal on the field it is about.
- An outbound cap, default 100 an hour.
- An `internal/mail` package that sends a message, used by the test now and
  by consumers later.
- An Email row on Diagnostics → Health.

Out:

- Every consumer: password reset, email verification, second factors,
  invites by email, notification digests.
- Email addresses on accounts.
- OAuth sign-in to the SMTP server (XOAUTH2 for Google and Microsoft). It
  would add an `auth` enum (`password` default, `oauth`) and its own
  fields; nothing below has to change.
- Provider APIs, DKIM signing, bounce handling.
- A custom CA or skipping certificate checks, until someone asks.

## Settings

One row in the settings table, key `smtp`, in `internal/instance/email.go`.
No migration.

```go
const keySMTP = "smtp"

// SMTP is the server Stoop sends mail through.
type SMTP struct {
	Enabled     bool     `json:"enabled"`
	Host        string   `json:"host"`
	Port        int      `json:"port"`
	Security    Security `json:"security"` // "starttls" | "tls" | "none"
	Username    string   `json:"username"`
	Password    string   `json:"password"`
	FromAddress string   `json:"from_address"`
	FromName    string   `json:"from_name"`
	HourlyLimit int      `json:"hourly_limit"`
}
```

| Field | Rule on save | Error lands on |
| --- | --- | --- |
| host | Required when enabled. A hostname or IP, no scheme, no port. | `smtp.host` |
| port | 1–65535. Empty takes the security mode's default: 587, 465, 25. | `smtp.port` |
| security | One of the three. `none` is refused while a username is set: a password is never sent in the clear. | `smtp.security` |
| username / password | Both or neither. Password is write-only; blank on save keeps the saved one (`keepSecret`). Clearing the username clears the password. | `smtp.password` |
| from_address | Required when enabled; one bare address (`net/mail.ParseAddress`). | `smtp.from_address` |
| from_name | Optional, at most 80 characters, no CR or LF. Blank sends the instance name. | `smtp.from_name` |
| hourly_limit | 0–100000; 0 is no cap. A row without it reads as 100. | `smtp.hourly_limit` |

Turning email off keeps every field. Every field is checked before anything
is written, so a refused save changes nothing.

### Environment

```
STOOP_SMTP_HOST=smtp.example.net
STOOP_SMTP_PORT=587
STOOP_SMTP_SECURITY=starttls
STOOP_SMTP_USERNAME=stoop@example.net
STOOP_SMTP_PASSWORD=…
STOOP_SMTP_FROM=stoop@example.net
STOOP_SMTP_FROM_NAME=
STOOP_SMTP_HOURLY_LIMIT=100
```

`SeedFromEnv` saves the group with `enabled: true` when `STOOP_SMTP_HOST`
is set and no `smtp` row exists. After that the row is the setting, and
the env-drift warning covers a `.env` that disagrees.

## API

`proto/stoop/instance/v1/email.proto`. The RPCs go on `InstanceService` and
need `InstanceSettingsManage`.

```protobuf
enum SmtpSecurity {
  SMTP_SECURITY_UNSPECIFIED = 0;
  SMTP_SECURITY_STARTTLS = 1;
  SMTP_SECURITY_TLS = 2;
  SMTP_SECURITY_NONE = 3;
}

message SmtpSettings {
  bool enabled = 1;
  string host = 2;
  uint32 port = 3;
  SmtpSecurity security = 4;
  string username = 5;
  // Write-only: never returned. has_password reports whether one is set.
  string password = 6;
  bool has_password = 7;
  string from_address = 8;
  string from_name = 9;
  uint32 hourly_limit = 10;
}

rpc GetEmailSettings(GetEmailSettingsRequest) returns (GetEmailSettingsResponse);
rpc UpdateEmailSettings(UpdateEmailSettingsRequest) returns (UpdateEmailSettingsResponse);
// Sends with the settings given (a blank password uses the saved one),
// so a change can be tried before it is saved.
rpc SendTestEmail(SendTestEmailRequest) returns (SendTestEmailResponse);
```

`GetInstanceStatus` gains `bool email_enabled`, which a consumer will read
to decide whether to show itself.

## Sending: `internal/mail`

```go
// Message is one email to one recipient.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string // optional; sent as multipart/alternative with Text
}

// Sender delivers a message through the configured server.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}
```

- The sender reads the `smtp` row on every send, so a saved change applies
  with no restart. `internal/app` wires it, so `mail` does not import
  `instance`.
- Client: `github.com/wneessen/go-mail`; `net/smtp` plus a small MIME
  helper is the fallback.
- `starttls` uses go-mail's mandatory TLS policy: no STARTTLS is an error,
  never a fall back to plain text. `tls` is implicit TLS. `none` is no TLS.
  Certificates are always verified.
- Sign-in: PLAIN, or LOGIN when that is all the server offers. Skipped
  without a username.
- Timeouts: 10 s to connect, 30 s for the whole send.
- Headers: From with the name, Date, a Message-ID on the sender's domain,
  `Auto-Submitted: auto-generated`.
- Logs: host, port, recipient domain, SMTP reply code. Never the password.

### Refusals, field by field

The test returns `apierr.Field` violations, so each lands under its field.

| What failed | Field | Message |
| --- | --- | --- |
| DNS lookup | `smtp.host` | Can't find smtp.example.net. |
| Connection refused or timed out | `smtp.port` | Nothing answered on smtp.example.net:587. |
| No STARTTLS offered; TLS against a plain port; plain against a TLS port | `smtp.security` | Port 465 expects TLS from the start. Pick TLS, or use port 587. |
| Certificate not valid for the host | `smtp.host` | The certificate isn't valid for smtp.example.net. |
| 530 / 534 / 535 on AUTH | `smtp.password` | smtp.example.net refused this username and password (535). |
| Server requires sign-in, none set | `smtp.username` | smtp.example.net needs a username and password. |
| 550 / 553 / 554 on MAIL FROM | `smtp.from_address` | smtp.example.net won't send from this address (550). |
| 550 / 553 on RCPT TO | `to` | smtp.example.net refused this recipient (550). |
| Hourly cap reached | `to` | This hour's 100 emails are used; try again after 14:00. |
| Anything else | form | The server's reply, code and text. |

Success means the server accepted the message, not that it arrived.

### The test endpoint

- Synchronous, not a job, so the answer lands on the form.
- Admin only, rate limited to 5 a minute per account.
- Subject "Test email from [instance name]", a two-line text body, no links.
- Not passed through `netguard`: the admin picks the host, and a LAN relay
  is a normal setup.

### Outbound cap

Every send counts, test or job. The count is a fixed one-hour window in
one settings row, `smtp_send_window` (`start`, `count`), bumped by one
atomic `UPDATE … RETURNING`, so it holds across processes. Over the cap,
`Send` returns `mail.ErrHourlyLimit` with the window's end.

## For the consumers that come later

None of this ships now.

- Consumers send through a `send_email` job kind, never inline in a request.
- Job arguments name a template and its inputs, never the rendered body: a
  reset link holds a secret, and finished jobs stay in the table.
- Connection failures, 4xx replies and the hourly cap retry; 5xx replies
  are discarded. `MaxInFlight` 2.
- A consumer checks `email_enabled` and hides itself when it is false.

## Diagnostics

A health check named Email, `FixTab: "email"`: off when no host is saved or
email is off; ok when the last send succeeded or nothing has been sent;
warn when the last send failed, with its error and time. The last outcome
is a settings row, `smtp_last_send` (`at`, `ok`, `error`), written by the
sender; it is in the database because `stoop jobs` can be its own process.
The check never dials the server.

## Web

- An Email tab after Login (`routes/Admin/EmailSection.tsx`).
- The fields and draft state are shared with the setup step in
  `components/EmailForm/`.
- Changing Security moves Port to the new default only when Port still
  holds the old default.
- The test row shows once a host is filled in.

### Setup wizard

An optional Email step between Voice and video and Invite people
(`steps.ts`: `{ id: "email", title: "Email", optional: true }`). Same
fields as the tab except From name and the hourly cap, plus the test row.
Continue saves and marks it done; Set up later marks it skipped. The last
step's summary shows "Email via <host>" or "Email skipped" with Set up.

## Testing

- Unit: the save rules, `keepSecret`, the env seed, the cap window, and
  each refusal against a fake server (`github.com/emersion/go-smtp`,
  test-only) over plain, STARTTLS and TLS.
- Over HTTP (`internal/app/e2e_*_test.go`): save, read back without the
  password, a test send to the fake server, a refused test that changes
  nothing.
- By hand: a scratch instance pointed at Mailpit (`axllent/mailpit`, SMTP
  :1025, inbox :8025).

## Delivery

1. Contract: proto, generated code, types and interfaces, RPC stubs.
2. Settings: `email.go`, env seed, `stoop admin`, Get and Update.
3. Sender: `internal/mail`, the cap, `SendTestEmail`, the refusal table.
4. Web: the shared form and the Email tab.
5. The setup step.
6. Health row and docs.

# Account email addresses and the send_email job

Status: accepted 2026-10-09, being built.

A person can add an email address to their account and confirm it from a
link, and Stoop sends that link through a background job. This is the
groundwork password reset stands on; reset itself is not in this work. It
builds on the SMTP settings and sender ([email.md](../architecture/email.md)).

## Decisions

- The address is optional.
- It is unique among confirmed addresses only. Nothing on screen says an
  address is taken; only the confirmation link, opened from that inbox, can.
- The person and instance admins see it; other members and bots never do.
- Changing or removing it needs the current password (when the account has
  one), and the old address gets a notice.
- A new sign-up through a login provider takes the provider's address as
  confirmed when `email_verified` is true and no one else has it.
- With email off, the profile's Email section is hidden.
- A deleted account gives its address up; a deactivated one keeps it.
- Admins can't set addresses (left out of version one).

Out: password reset, digests, invites by email, the template system and the
email wording (plain text in code until then), requiring an address.

## The send_email job

One kind, `send_email`, registered in `internal/app`. Its arguments name the
message and who it is for, never the finished email:

| Template | Arguments | Built by |
| --- | --- | --- |
| `confirm_email` | `user_id` | auth |
| `email_changed` | `user_id`, `old_address` | auth |

```go
// internal/mail
type JobArgs struct {
	Template   string `json:"template"`
	UserID     string `json:"user_id"`
	OldAddress string `json:"old_address,omitempty"`
}

// Site is what a message needs from the instance.
type Site struct {
	PublicURL    string
	InstanceName string
}

type Builder func(ctx context.Context, args JobArgs, site Site) (Message, error)
```

The job looks up the template's builder, runs it, and sends through the
instance's `mail.Sender`. The builder runs at send time, so a link's token is
made then: the raw token exists only in memory and in the email, never in the
job's arguments or error, the database (hash only), the logs or
`smtp_last_send`. An unknown template is discarded.

`confirm_email`'s builder reads the pending address (none, or a deactivated
account: `mail.ErrNothingToSend`, the job finishes), mints a token (32 random
bytes, SHA-256 stored, 24 hours, older unused ones of the purpose revoked),
and builds `<public URL>/confirm-email?token=…`. No public URL:
`mail.ErrNoPublicURL`. A retry builds again, so only the last link sent works.

| Outcome | Job |
| --- | --- |
| Sent, or nothing to send | done |
| Connection failed, 4xx reply | retry: 1 min, 5 min, 30 min; 5 attempts |
| Hourly cap | retry at the window's end |
| 5xx, not configured, no public URL | discard |

`MaxInFlight` 2 across all email.

## Data

Migration `00060_account_email.sql`, additive only:

```sql
ALTER TABLE users
    ADD COLUMN email              citext,       -- confirmed only
    ADD COLUMN email_confirmed_at timestamptz,
    ADD COLUMN pending_email      citext,
    ADD COLUMN pending_email_at   timestamptz;

CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL;

CREATE TABLE email_tokens (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('confirm_email')),
    token_hash bytea NOT NULL UNIQUE,
    address    citext NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
```

The credential sweep deletes tokens a day past expiry or use.

## Flows

**Add or change.** `RequestEmailChange{address, password}` checks the
password and the address's shape (one bare address, at most 254
characters), sets the pending address, and queues `confirm_email` in the same
transaction. The reply is the same whether or not someone has the address.
Limited to 3 an hour per account, shared with `ResendEmailConfirmation`.
`CancelEmailChange` clears the pending address and revokes its tokens.

**Confirm.** The link opens `/confirm-email?token=…`; the page has a Confirm
button and does nothing on load, so a mail scanner can't confirm.
`ConfirmEmail{token}` is public: it matches the hash **and** the purpose,
unused and unexpired, and the account's pending address. If another account
confirmed the address first, it says the address is already in use (the only
place that's said). Otherwise the address becomes `email`, the token is used,
and an old address gets `email_changed`. A bad, used or expired token gets
one message for all three.

**Remove.** `RemoveEmail{password}` clears both addresses and the tokens.

**Provider sign-up.** A new account through a provider takes a verified,
unclaimed `email` claim as confirmed. Existing accounts aren't touched.

**Delete.** Deleting an account clears its addresses and tokens.

## API

The address never goes on `User`, which other members receive.

- `GetMeResponse.email`: `MyEmail{address, pending_address}`.
- `InstanceUser.email` (field 15): the confirmed address, for admins.
- `RequestEmailChange`, `ResendEmailConfirmation`, `CancelEmailChange`,
  `RemoveEmail`: `AccountSecurity`. `ConfirmEmail`: public.
- With email off, `RequestEmailChange` and `ResendEmailConfirmation` refuse
  with FailedPrecondition.

## Web

- Profile → Email, shown while `email_enabled`: no address (Add), pending
  ("Check … for a link": Resend, Cancel), confirmed (Change, Remove). The
  form asks for the password when the account has one; refusals land under
  their field.
- `/confirm-email`: the login card with one line and Confirm, then the
  outcome. The token is dropped from the address bar once read.
- The admin account list shows the confirmed address.

## Testing

Unit tests for tokens, the retry table and the rules; HTTP tests with the fake
SMTP server for the whole flow, the already-in-use case, expiry and reuse,
email off, the notice to the old address, deletion; a test that the token
from a received link is nowhere in the jobs row and only hashed in
`email_tokens`; a scratch-instance browser walk with Mailpit.

## Delivery

1. Sending plumbing: the job, the builders, token minting.
2. Accounts: the RPCs, confirmation, provider sign-up, deletion, the sweep.
3. Web: the profile section, the confirm page, the admin column.
4. Docs: identity.md and email.md; this file deleted.

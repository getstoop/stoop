# Email

Stoop can send mail through an SMTP server you choose. It is optional.
It lets people confirm an email address on their account and reset a
forgotten password with it. Reset links also need the server's public URL.

## Setting it up

**Server admin → Email**, or the Email step in first-run setup. Fill in the
host, security, port, username, password and from address, send yourself a
test, and save. A refused test says which field is wrong.

Or set it in `.env` before the first start; it is read once, and after
that the admin page is the setting:

```
STOOP_SMTP_HOST=smtp.example.net
STOOP_SMTP_PORT=587
STOOP_SMTP_SECURITY=starttls
STOOP_SMTP_USERNAME=stoop@example.net
STOOP_SMTP_PASSWORD=…
STOOP_SMTP_FROM=stoop@example.net
```

All of them are in the [configuration reference](configuration.md).

## Which server

Any SMTP server works:

- **A mail provider's SMTP relay.** Most transactional senders have a free
  tier and give you a host, port, username and password. Use a from address
  on a domain you verified with them.
- **Gmail.** Turn on 2-Step Verification, create an app password, and use
  `smtp.gmail.com`, port 587, STARTTLS, your address as the username and
  the app password as the password.
- **Outlook.com and Microsoft 365** are retiring password sign-in over SMTP.
  Use a mail provider's relay instead.
- **A relay on your network** (Postfix and the like): security **None**,
  no username or password. Stoop refuses a password over an unencrypted
  connection.

A relay with a self-signed certificate is not supported over STARTTLS or
TLS.

## Addresses on accounts

With email on, people can add an address under **Profile → Security** and
confirm it from a link. The link points at the server's public address, so
set that too (**Server admin → Hosting**); without it, asking for a link is
refused.

## Trying it without a provider

Mailpit catches mail and shows it in a web inbox:

```sh
docker run -d --name mailpit -p 8025:8025 -p 1025:1025 axllent/mailpit
```

Point Stoop at it with host `mailpit` (on the same Compose network) or the
machine's address, port 1025, security **None**, no username, then open
`http://localhost:8025`.

## The hourly cap

Stoop sends at most 100 emails an hour by default, tests included, so a
bug or a burst can't get your account suspended. Change it under **Server
admin → Email**; 0 means no cap.

## When sending fails

**Server admin → Diagnostics → Health** has an Email row. It shows the last
send's error and links to the Email tab. It never signs in to the server
itself.

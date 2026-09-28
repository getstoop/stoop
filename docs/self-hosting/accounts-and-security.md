# Accounts and security

## Privacy of direct messages

Direct messages are private *in the app*: nothing lets a server admin
list or read a conversation they are not part of, and a file sent in a
DM is served only to the people in it. They are not private from the
machine. Like every message, DMs sit in Postgres in plaintext and in
your backups, readable by anyone with the database password or the
disk. Stoop does not do end-to-end encryption today; tell your people
that before they assume otherwise.

## Security headers

Stoop sets these on every response; there is nothing to configure. **If
you put a reverse proxy in front, leave them alone.** A second
`Content-Security-Policy` header does not replace Stoop's: both apply, and
the intersection blocks part of the app. Don't add `includeSubDomains` or
`preload` on Stoop's behalf either unless you own every name under that
domain.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone and screen share for Stoop itself; everything else refused |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000`, **only** over HTTPS |

HSTS is sent only when the request arrived over TLS — directly, or with
`X-Forwarded-Proto: https` from an address you named under Trusted
proxies — so a LAN or tailnet install reached over plain HTTP never gets
it. The content policy is "everything comes from this server". What each
directive allows, and why, is in
[architecture/runtime.md](../architecture/runtime.md#security-headers).

`GET /version` tells anyone which Stoop version this is; the desktop app
needs it before login. The web app's asset names already change with
every release, so hiding it would gain nothing.

## Keeping people out

Two tools, at two levels:

- **Kick and ban** (space owners and admins): both live in *Space
  settings → Members* — a profile card never carries them, so nobody
  removes someone with a stray click. A kick only removes: they can
  come back with any invite link. A ban removes them *and* refuses
  every invite link until someone unbans them under *Space settings →
  Banned*. Either one also disconnects them from the space's voice
  channels.
- **Block** (anyone): from a person's card, undone from your profile
  page. No direct messages either way, and no mention, reply or DM
  alerts from them. Their messages in shared channels still show.

Neither tells the other person why. Deleting someone's account outright
is the server admin's job on the admin page.

## Who can create accounts

By default new accounts need a space invite code (the first account, created
during setup, is exempt and becomes the server admin). The admin can change
this at runtime under **Server admin**: *Invite only*,
*Open*, or *Closed* (admin-created accounts only). `STOOP_REGISTRATION=open|invite|closed`
only seeds the initial value on first boot.

An invite link works for newcomers and existing accounts alike: the
landing page asks "new here, or already have an account?", and someone
who is a member of another space on the server just logs in and joins.
Under *Closed*, only the log-in path is offered.

The policy covers login providers too: "Continue with Google" from an
invite link creates the account and redeems the invite in one go, and
under *Closed* a provider only signs in accounts that already exist (or
were linked from a profile).

## Signing in with an identity provider

People can sign in and create their account with an identity they
already have, instead of a Stoop password. Any OIDC
provider works: a self-hosted IdP (Authentik, Authelia, Keycloak,
Pocket ID), Google, or Microsoft (with a tenant id; the `common`
pseudo-tenant is not supported). Configure it under **Server admin →
Login**:

1. Set a public URL first (Hosting tab) — the provider console needs the
   exact callback URL, `https://<public url>/auth/callback/<id>`, which
   the Login tab shows with a copy button.
2. Create an "OAuth2/OpenID" application in your provider's console with
   that callback (redirect) URL, and paste the issuer URL, client id, and
   client secret into the Login tab. The secret is write-only: the server
   never shows it again.
3. The login page now offers "Continue with …". An existing account can
   attach the provider from **Profile → Linked accounts**; an account
   created through a provider has no password until it sets one on the
   profile page (do that — it keeps you out of trouble if the provider
   goes away, and it's required before unlinking the only identity).

One provider can also come from the environment (`STOOP_OIDC_*` in the
[Configuration reference](configuration.md)); the admin page's
saved list overrides it, the same as the Hosting settings. Sign-ins
survive a server restart, but a sign-in *in flight* across one is
abandoned with "sign-in took too long" — just click the button again.
The public URL's scheme must match how people actually reach the server
(https behind a proxy or tunnel), or the sign-in state cookie is lost on
the way back.

### Turning passwords off

Once a provider works, **Server admin → Login → Password sign-in** can
restrict the username/password form to *Server admins only* or turn it
*Off*, so the server stops being a password store. Members then sign in
(and, policy permitting, sign up) only through providers. The server
refuses to restrict it while no provider is configured.

Admins are the break-glass: the server always honours an admin's
password, and `/login?password=1` shows the hidden form. Mind that an
admin who signed up *through* a provider has no password — set one on
your profile (the card stays visible to admins) or, if the provider is
down and nobody can log in, use the CLI on the server:
`stoop admin password-login everyone` flips the setting back and
`stoop admin reset-password <username>` gives any account a temporary
password.

Privacy: the provider learns that this person signs in to *this server*
(the callback URL names it) and when. A self-hosted IdP keeps that
knowledge at home. The server stores which provider identity belongs to
which account and nothing else — no provider tokens.

## Deleting your own account

Anyone can delete their own account from **Profile → Security**, after
typing their password again. Their messages stay in the channels and
conversations they were in, under their username marked "(deleted)";
their profile, avatar and bio go, every device is signed out, their tokens
stop working, and any space they owned passes to its longest-serving
admin, or to yours when it had none. The username stays taken, so nobody
can register it and be mistaken for them. There is no undo, and an admin
cannot reactivate the account.

To turn this off, untick **People can delete their own accounts** under
**Server admin → Accounts**. The account page then says to ask an admin,
and deactivating from that tab is what an admin does instead.

## Forgotten passwords

There is no email, so nobody can reset their own password. If a login
provider is linked, "Continue with …" still works. Otherwise a server admin
resets it for them: Server admin → Accounts → **Reset password** sets a
temporary password, shows it once (copy it and pass it on), and signs the
account out everywhere; the person then picks a new one on their profile
page. If the admin is the one locked out, use the CLI below.

## Locked out of admin?

The binary doubles as a maintenance CLI: `stoop` with `admin` as its first
argument runs the command and exits instead of serving. It reads
`STOOP_DATABASE_URL` from the same environment and talks to the database
directly, so the server can keep running:

```
stoop admin list
stoop admin promote <username>
stoop admin demote <username>
stoop admin reset-password <username>
stoop admin transfer-owner <username>
stoop admin password-login everyone|admins|off
```

The first account owns the server: no admin can demote, deactivate or
reset it from the admin page. `reset-password` and `transfer-owner` work
on the owner from here. It refuses to demote the owner or the last active
admin. With the bare binary, run it
by path (`./stoop admin list`) or put it on your `PATH`. In Docker the
image installs it at `/usr/local/bin/stoop`, so:
`docker compose exec stoop stoop admin promote <username>` (the first
`stoop` is the compose service, the second the command).

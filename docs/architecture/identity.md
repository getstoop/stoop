# Identity: accounts, sessions, and sign-in

`internal/auth` owns who someone is. It does not own what they may do —
that is [permissions.md](permissions.md) — and it deliberately owns very
little machinery, because the machinery is where authentication systems go
wrong.

Two design commitments shape everything below:

**One account per instance, many spaces.** Discord's identity model, not
Slack's. You sign in once and participate in every space you belong to.

**No email.** Stoop has no mail transport and does not want one — an
operator running a Pi should not have to configure SMTP or sign up for a
sending service to have a working chat server. That single decision removes
email verification, password-reset links, and magic links from the design,
and it is why account recovery is an admin action or a CLI command rather
than a self-service flow.

## Accounts

`users` rows are never deleted. Deactivation (`deactivated_at`) prevents
login and revokes every session immediately, but keeps the row so old
messages keep an author. Deleting the row would either orphan authorship or
destroy other people's conversations; neither is a defensible answer to
"someone left".

**The id is the identity.** `users.id` is what every other table, every
port and every event references. Usernames are therefore freely renameable
without any consequence beyond display — a property most systems have to
retrofit painfully. `username` is `citext`, so handles are
case-insensitive; `display_name` keeps whatever capitalisation was typed.

Two flags qualify a handle. `username_pending` marks a handle derived from
a provider claim that its owner hasn't confirmed, so the client can nudge
them once. `username_frozen` is an admin lock on self-service renames,
for after an offensive handle has been cleaned up; admin renames bypass it.

### Profiles

`users.pronouns` (40 characters) and `users.bio` (300), both plain text run
through a whitespace collapse so neither can become a paragraph. They
appear in exactly one place: the profile card, opened by clicking a name.

**They deliberately do not ride on `chat.Member` or `chat.MessageAuthor`.**
Those types exist to render lists cheaply, and no list shows these fields.
A roster is dense, and pronouns trailing a name everywhere buys visibility
at the cost of the surface people actually use to find someone. Instead the
card reads one person through `AuthService.GetUserProfile` — which is also
why it works identically in a DM and in a space, and why nothing here is
realtime: the card fetches fresh on open, as it already did to render a
renamed author on an old message.

Putting a 300-character mutable string on `MessageAuthor` would
denormalise it onto every message of every history page. Anything that
wants these fields in a list has to add them to a port and a proto, and
argue with this paragraph first.

**Profiles are public to any signed-in user** — the same line drawn for
avatars in [files.md](files.md), and a policy rather than an oversight.
There is no shared-space test, which also keeps the whole feature inside
`internal/auth`: the membership tables belong to chat, so gating on them
would mean a port from auth into chat for a card that shows two short
strings.

Moderation is **clearing only** (`instance.ClearUserProfile`, admins). An
admin sometimes needs to take down a slur; nobody needs an admin authoring
someone else's self-description, so there is no admin path that *writes*
either field.

## Passwords

argon2id, via `alexedwards/argon2id`, with parameters that are
configurable because "sensible defaults" for argon2 memory are hostile to
Pi-class hardware.

`password_hash` is **nullable**: an account created through an identity
provider has no password until its owner sets one, and "has a password" is
a schema fact rather than a sentinel hash that some code path might get
wrong.

### Not leaking which handles exist

Three behaviours cooperate, and all three are needed:

- **Unknown users are verified against a dummy hash.** A login for a handle
  that doesn't exist still pays for an argon2id comparison, so response
  time doesn't distinguish "no such user" from "wrong password". A
  provider-created account with no password takes the same path.
- **The lockout is keyed on the handle as typed**, normalised the way
  registration normalises it, whether or not it names a real account.
  Otherwise the lockout itself would be the oracle the timing defence
  closed.
- **The password-sign-in policy is checked *after* the password.** If
  `password_sign_in` is `admins`, a member's correct password is refused —
  but a wrong password for that same account is refused first, with the
  same message, so the refusal never reveals the account's role.

### Lockout

`loginGuard` is per-process, in-memory: five consecutive failures lock a
handle for 30 seconds, doubling per further failure to a 15-minute
maximum, cleared by a success.

It exists because the per-IP rate limiter cannot see a distributed attack.
A botnet with a thousand addresses gets a thousand IP budgets against one
password; the per-handle guard is what makes that not work. The state is
bounded — idle entries pruned after an hour, at most 50,000 keys — because
an unbounded map keyed on attacker-supplied strings is itself a
vulnerability.

## Sessions

**Opaque 32-byte random tokens.** The database stores only `SHA-256(token)`.
A database dump therefore does not contain live credentials, and revocation
is a `DELETE` — instant, no key rotation, no "the JWT is still valid for
another nine minutes".

No JWTs anywhere in the session path. Statelessness buys nothing here: this
is a single process that already has a database open.

Delivery is both:

- An `HttpOnly`, `SameSite=Lax` cookie (`stoop_session`, 30-day TTL) —
  which is what browsers use, and what the WebSocket upgrade carries.
- The token in the `Login` response body, for future bearer clients.
  `TokenFromHeader` prefers `Authorization: Bearer …` and falls back to the
  cookie, so both work everywhere without a second code path.

**The `Secure` flag is decided per request**, not per deployment
(`authctx.SecureTransport`, set by the `secureTransport` middleware). It is
set when the request arrived over TLS — the Tailscale listener does — or
carried `X-Forwarded-Proto: https` from a peer in the trusted-proxy set, or
always when `STOOP_SECURE_COOKIES` is on. This matters because a plain
listener and a TLS listener can coexist in the same process, so "is this
connection secure?" genuinely varies per request.

## Enforcement

One Connect interceptor, built by `auth.NewInterceptor`, validates the
token and deposits an `authctx.Identity{UserID, SessionID, Role}` into the
request context. Every other module reads identity from the context and
therefore never imports auth — `internal/authctx` is a single file that
imports nothing and may be imported by everything, playing the role a
shared proto would play between separate services.

**Public procedures** are `Register` and `Login` always, plus whatever
`internal/app` allowlists through `auth.Options.PublicProcedures`:
`GetInstanceStatus` (the setup and login screens need it before anyone has
an account) and `LookupInvite` (an invited stranger has to see what they
were invited to).

A public procedure still gets an identity **when a valid session is
present**. That is not a loophole; it is load-bearing. It is how an admin
creates an account under a `closed` registration policy: the same
`Register` procedure, behaving differently because it can see who is
calling.

A public procedure answers with the *public face* of a thing only.
`LookupInvite` returns a space's name, icon, description, size and the role
the code grants — never its welcome text, which is for people who joined.

The WebSocket upgrade and the file download handler both authenticate
through the same `VerifyRequest` path rather than through the interceptor,
because neither is a Connect call. There is one implementation of "is this
a valid session".

## Provider sign-in (OIDC)

Generic OIDC, via `go-oidc` and `golang.org/x/oauth2`. Two browser routes,
not RPCs:

```
GET /auth/oidc/{provider}/start   → 302 to the issuer
GET /auth/callback/{provider}     → verifies, then the usual session cookie
```

The flow is authorization-code with **PKCE and a nonce**. The provider is
consulted at sign-in and never again: **no provider tokens are persisted**,
and they do not outlive the `exchange` call. What persists is the mapping
`(provider, subject) → user` in `user_identities`, plus the email claim for
display.

**Round-trip state rides in one short-lived cookie.** `stoop_login` is an
HMAC-signed, `SameSite=Lax`, 10-minute cookie carrying the state parameter,
the nonce, the PKCE verifier, and the intent: an invite code, a link
target, a post-login redirect. The signing key is per process, so a restart
mid-login means "sign-in expired" rather than a confusing failure.

That cookie is doing two jobs, and the second is the important one: **it is
the browser binding that defeats login-CSRF.** A `state` parameter that
isn't tied to the browser that started the flow proves nothing. Because the
state lives in a cookie only that browser has, an attacker cannot complete
a sign-in into someone else's session.

**Account linking** has the same shape and one extra check. Starting a link
requires a live session; the callback re-verifies *the same session id*, so
a `stoop_login` cookie planted on someone else's browser cannot attach an
attacker's provider identity to their account.

**Usernames from providers** are derived from a claim, marked
`username_pending`, and the owner may rename once — after which they are
like everyone else's. Because the durable identity is `users.id` and
identities link by subject, a rename breaks nothing.

**Provider configuration is instance-owned**, not auth-owned: the
`login_providers` setting with `STOOP_OIDC_*` as an environment fallback,
reaching auth through the consumer-owned `auth.ProviderSource` port. The
registration policy and invites apply to a provider sign-up through exactly
the same ports as `Register` does, so there is no second policy path to
keep in sync.

**The redirect URI is always built from the effective public URL, never the
request `Host`.** A redirect URI derived from an attacker-controlled header
is a classic open-redirect into an OAuth flow.

The callback routes share the Login/Register rate-limit bucket.

### Turning passwords off

`password_sign_in` is an instance setting with three values: `everyone`,
`admins`, `off`. It reaches auth through the `auth.PasswordPolicy` port.

- Checked **after** the password, as described above.
- **Instance admins are always honoured** — this is the break-glass. If the
  identity provider is down, the operator can still get in.
- `Register` follows it, except for bootstrap and admin-created accounts.
- It cannot drop below `everyone` when no provider is configured, which
  would lock everyone out of a working server.
- `stoop admin password-login <everyone|admins|off>` writes it from the
  command line, without the guard, for when the admin page is what you
  can't reach.

## Abuse controls on the anonymous surface

`internal/ratelimit` is in-memory, per-process token buckets. That is a
deliberate ceiling: a limiter that required Redis would never be turned on
by the audience this project serves, and an unprotected server is worse
than an imperfectly protected one. A Cloudflare WAF rule in front is a
welcome second layer and never a substitute.

| Surface | Knob | Response |
| ------- | ---- | -------- |
| `Login`, `Register`, `LookupInvite` | `STOOP_AUTH_RATE_LIMIT` (per IP per minute) | `ResourceExhausted` + `Retry-After` |
| `/auth/…` OIDC routes | Same bucket | Redirect to an error |
| `/livekit` signaling | `STOOP_SIGNALING_RATE_LIMIT` | `429` |

The signaling proxy needs its own limit because it is the one plain handler
with no session check — LiveKit validates the room token, so the proxy
can't — which without a limit would make it an open relay.

The limiter maps are bounded (100,000 keys) and, when full, new keys share
one overflow bucket rather than being waved through. Buckets idle past the
refill horizon are dropped.

**Client IP** is the TCP peer, *or* the first `X-Forwarded-For` hop when
the peer is a trusted proxy. Never otherwise: anyone who can reach the port
directly could pick their own key, and a fresh bucket per made-up address
is no limit at all.

**Trusted proxies** (`internal/trustedproxy`) are named addresses or CIDR
ranges, saved like any other reachability setting but deliberately
independent of the way in — an internal proxy can sit in front of a tunnel,
a tailnet, or nothing. Three places ask "may this peer's forwarded headers
be believed?": the rate-limit interceptor, the signaling middleware, and
`secureTransport`. All three call `instance.Service.TrustsPeer`, which
reads an `atomic.Pointer` cache refreshed at startup and on every save — so
a change applies to the next request, with no restart and no database read
on the hot path. `STOOP_TRUST_PROXY=true` maps to the legacy
trust-everyone set and is the fallback when no addresses are saved.

Independently, every Connect handler caps request bodies at 4 MiB
(`WithReadMaxBytes`); the largest legitimate Connect payload is a 2 MB
avatar.

## CSRF posture

- Connect calls are **POST-only** with a required content type, so they are
  not simple form submissions.
- Session cookies are `SameSite=Lax`.
- The OIDC state cookie is the browser binding for the login flow.
- WebSocket origins are checked against the request host,
  `STOOP_PUBLIC_URL`'s host, and `STOOP_ALLOWED_WS_ORIGINS`.
- The CSP sets `form-action 'self'` and `frame-ancestors 'none'`; see
  [runtime.md](runtime.md).

## Recovery

There is no "forgot password" email, because there is no email.

- An instance admin can reset any account's password from the admin page;
  the temporary password is shown once.
- `stoop admin` talks to `STOOP_DATABASE_URL` directly, with the server
  still running: `list`, `promote`, `demote`, `reset-password`,
  `password-login`. This is the path back in when the admin page itself is
  what you have locked yourself out of.

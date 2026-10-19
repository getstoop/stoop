# Confirm it's you: reauthenticating before account changes

Status: built (STOOP-511); identity.md → Confirm it's you is the reference now. Tracks STOOP-511. Designs: the "Confirm it's
you" canvas (https://claude.ai/artifact/SGWADXkiH89FLSJ9x61EVA).

## The problem

A stolen session (a copied cookie or a phone's bearer token) must not be
enough to take an account over for good. Today it nearly is:

- **Linking a login provider needs only a session** (`oidcStart` with
  `link=1`, `desktopStart` with `link: true`). A thief links their own
  identity and can sign in as the victim indefinitely; changing the
  password, a reset and "sign out everywhere" all leave the link in place.
- **A personal token outlives every eviction.** `CreatePersonalToken`
  needs only `account.security`, a token may never expire, and
  `RevokeOtherSessions` deletes sessions only.
- **"Sign out everywhere" keeps the caller's own session**, so a thief
  holding a copy of *that* session stays in.
- **Current-password checks are unthrottled**: `ChangePassword`,
  `RequestEmailChange`, `RemoveEmail` and `DeleteAccount` can be used to
  guess a password without limit.

#501 already made a passwordless account need a sign-in under 10 minutes
old for its password, email and deletion. That rule is the base this
builds on.

## The design

**Every sensitive change needs a recent sign-in, and the way to get one is
to sign in again in place.** No change takes an inline current password any
more; one rule covers accounts with and without a password.

1. A refused change (FailedPrecondition, "sign in again first, then …")
   or a settings page opened with an old session shows *Confirm it's
   you*, linking to `/confirm?next=/profile?tab=security`.
2. The confirm page shows the password field when the
   account has a password and one button per provider **linked to this
   account**. No username: the session says whose account it is (a
   hidden `autocomplete="username"` field keeps password managers
   working). No create-account, no forgot
   password, no explanation of which ways are offered, and the server's
   origin shown plainly.
3. On success the server **mints a new session and deletes the old one**,
   then goes to `next`.
4. A sensitive change requires a session created under **5 minutes** ago:
   the existing `requireRecentSignIn`, with the window shortened.

Replacing the session rather than marking it is the point. A thief and the
victim share one session (stealing it means copying its token), so a mark
on it would be shared too, and a victim talked into reauthing would confirm
the thief's copy. A new session goes only to the client that reauthed; the
copy dies. Other devices keep their own sessions and are not touched.

### What the server enforces

- **Same account.** Reauth is bound to the session that started it, like
  a link attempt (`loginState.SessionID`). The identity or password that
  comes back must be the session's user, and the session must still be
  live. Anything else is refused, never an account switch, never a new
  account. The refusal is the same generic "Couldn't confirm it's you"
  as a wrong password: it never says the identity belongs to another
  account, which would leak that it exists. The provider callback gets its own branch for this, not
  `finishSocial`, which registers unknown identities.
- **Ask the provider for a fresh login**: `prompt=login` and `max_age=0`
  via `oauth2.SetAuthURLParam` in `authURL`. Providers that ignore them
  are still accepted, and `auth_time` is not checked: a server whose only
  provider can't force a login, with no email set up, would otherwise
  lock every passwordless account out of its own settings. The attacker
  then needs both the Stoop session and the victim's provider session,
  which a copied token doesn't bring.
- **Throttled passwords.** The reauth password check goes through the
  same `loginGuard` as sign-in, keyed on the handle.
- **A safe `next`**: `safeRedirectPath`, falling back to `/profile`.

### Which changes are sensitive

Setting or changing the password, changing or removing the email address,
deleting the account, linking and unlinking a login provider, creating a
personal token. Later: the admin actions that grant lasting access (bot
credentials, changing someone's role, resetting someone else's password).

### Desktop and phone

Reauth is a third kind of hand-off attempt next to sign-in and link
(`/auth/desktop/start {"reauth": true}`), recording the session that
started it and checked again at `/auth/desktop/complete`, which returns
the new token in place of the old one. The desktop app is same-origin and
cookie-based, so it follows the browser flow. The phone gets a *Confirm
it's you* screen once it has account settings.

### Other tabs

Tabs share the cookie and pick the new session up on their next request.
A tab's open realtime connection is on the old session, though, and
deleting it announces a revocation. No new event is needed: a tab whose
socket closes as revoked asks who it is again, and when that works (the
browser holds the new cookie) it reconnects instead of signing out.

## Pull requests

1. **Close the open holes.** Linking a provider and creating a personal
   token need a recent sign-in, and a token never counts as one. "Sign
   out everywhere" (`SignOutEverywhere`) ends every session, this one
   included, and every personal token; the person signs in again, so no
   session is handed back that a thief could use. Current-password checks
   go through `loginGuard`. A link is checked when it starts only: the
   round trip is bound to that session, so a second check when it is
   written would refuse a slow sign-in and stop nothing.
2. **The reauth flow.** The confirm page, the reauth
   callback branch, session replacement and its announcement, the window
   down to 5 minutes, and the inline password fields off the forms.
3. **Later.** Admin actions behind the same gate; the phone's reauth
   screen with its account settings.

## Tests

Go tests, per sensitive RPC, for a stolen-session account: an old session
is refused; a session replaced by reauth is accepted; the replaced
session's token no longer works. Reauth coming back as a different
account is refused and changes nothing. A browser spec walks settings →
Confirm it's you → back with the change allowed.

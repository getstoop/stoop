Stoop 0.13.0

**Confirm it's you.** Changes that could keep an account after its session
is stolen now need a log-in from the last five minutes, and the way to get
one without logging out is the new **Confirm it's you** page (`/confirm`):
the password, or a login provider linked to the account. Confirming
replaces the session, so a stolen copy of it stops working.

- **For people:** changing the password or email, linking or unlinking a
  provider, making a personal token and deleting the account ask to
  confirm first. The forms no longer ask for the current password. The
  Security tab shows a banner and holds those sections until then.
- **Log out everywhere** (was "Sign out everywhere else") now logs out
  this device too and revokes every personal token.
- **For admins:** resetting a password, changing a role, handing on
  ownership, the login providers, the email (SMTP) settings, and making a
  bot token or a webhook URL or secret also need a recent log-in. Server
  admin offers Confirm it's you when one is refused. A temporary password
  after a reset now shows in a modal that says what happens for the
  person.
- **Desktop app:** confirming with a provider opens the system browser
  and returns to the app, as signing in does.

**API changes** (`stoop.auth.v1`):

- `RevokeOtherSessions` is replaced by `SignOutEverywhere`, which ends the
  calling session too.
- New `Reauthenticate` (confirm with the password).
- The current-password fields on `ChangePassword`, `RequestEmailChange`,
  `RemoveEmail` and `DeleteAccount` are deprecated and ignored; these need
  a recent log-in instead. A refusal is `failed_precondition` with the
  response header `Stoop-Confirm: required`.
- **Scripts using a personal token** for the admin actions above are now
  refused: a token is never a recent log-in. Do those from the app.

**Also:** `#channel` links in messages, and a pasted message link shows who
said it and where.

**Upgrading:** no database migrations and no pinned versions moved. Rolls
back to 0.12.0 as usual. People are not logged out by the upgrade.

**Known issues:** none.

Changes since 0.12.0:

- Bump the actions group with 4 updates (c366dfa7)
- Add an Expo development build that reaches the server from a phone (2a3e7d99)
- Leave merging to the maintainer instead of auto-merging (888795e7)
- Keep mobile/ out of the Docker build context (41923eec)
- Link #channels in messages (972dd9cc)
- Close the gaps review found in #channel links (4f0e3787)
- Take the mobile push proposal back out of this branch (438058b8)
- Show pasted message links as who said it and where (c1233f5b)
- Drop the space between # and a channel's name (b0be8ff8)
- Show the welcome screen in the web app's themes (7e27d8ac)
- Expect #general in the browser specs (ed8c399b)
- Add a server: check a typed address, on Expo Router (6574e6e8)
- Sign in from the phone: password, providers, a new account (1aaa0a0a)
- Sign in: no cookies, confirm password, forgot password (d5cc0607)
- Ask a passwordless account for a recent sign-in, not nothing (6945fc70)
- Sign in: answer review — bounded sign-out, ordered saves, a retry (57498693)
- Sign in: check again after saving that the person is still here (0b63d1c9)
- Proposal: confirm it's you before account changes (f4f1d4dc)
- Auth: no lasting way in from a stolen session (6be66579)
- Sign out everywhere: this session too, and no token slips past it (cdfff977)
- Confirm it's you: reauthenticate in place before account changes (a6919ece)
- Confirm: go back by href, keeping the target's query (ede4b4e4)
- Reauth: replace a session once, and keep other tabs through it (4df925f1)
- Redirects: refuse /\host too; check a refused desktop code is spent (362bca0a)
- Tidy what still described the old password checks (28dc15de)
- Realtime: report the call on a fresh socket, not only a reconnect (2adff386)
- Security tab: signing out first, and what waits for confirming dimmed (861f74ca)
- Security tab: a rule above the banner, a tighter Sign out everywhere (a340dd39)
- Security tab: no rule under the banner (475c230e)
- Security tab: say plainly what confirming means (0a026552)
- Security tab: the banner's explanation on its own line (86601c4e)
- Security tab: Log out everywhere, as the sidebar says Log out (d4419ec3)
- Security tab: dimmed once, inert while waiting, and log in throughout (7fd116d3)
- Security tab: logged out in the delete-account text too (68c76ad8)
- Admin actions that hand out lasting access need a recent sign-in (5f09fab7)
- Server admin: the temporary password after a reset, in a modal (9c310746)
- Reset modal: room around the password, and a copy icon (839022c7)
- One component for a secret shown once (fc8fd1c3)

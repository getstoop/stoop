# Access model: who asks, with what, for what

Status: decided 2026-09-13, built 2026-09-14. Tracked as STOOP-269
(Access 1–6). Access 1 (the vocabulary, the procedure registry, the
credential gate), Access 2 (the credentials table, bounds, `users.kind`),
Access 3 (`stoop.access.v1.Permission`, `Space.my_permissions`, `GetMe`'s
permissions), Access 4 (personal tokens; see
[identity.md](../architecture/identity.md#personal-tokens)) and Access 5
(`/ws` and `/files` filtered per credential; see
[realtime.md](../architecture/realtime.md#credentials)) are in. Access 6
reshaped the webhooks plan (STOOP-256).

Every request answers three questions: **who is asking** (the identity),
**what they are asking with** (the credential), and **what the ask
requires** (an action on a resource). Until now Stoop only asked the first:
a session was the user, carrying all of their authority, so nothing could
present less than everything its holder is.

## The rule

```
allowed = identity holds action on resource
      and credential covers action on resource
```

An intersection, never a union. A credential only ever narrows what its
holder has, and both gates run on every request, so a credential never
outlives a demotion — the double cap invites already have, everywhere.

A session covers every action, so a person using the web app sees no
change. The model only shows when something narrower is presented.

## Four nouns

- **Identity** — a `users` row, of kind `person` or `bot`. Holds an
  instance role on the instance and a membership role in each space.
- **Credential** — a session, a personal token, a bot token, or an incoming
  hook URL. Each has a holder, a grant, optional bounds, an expiry and a
  revocation.
- **Action** — one entry from a closed vocabulary fixed in code
  (`internal/authctx/actions.go`). Roles are fixed sets of actions; grants
  are subsets of them.
- **Resource** — the instance, a space, a channel, or the caller's own
  account. The instance and the space are two kinds of resource under one
  system, not two systems.

## Worked examples

Casey runs the instance. ops-bot is a bot Casey put in the Homelab space
as an admin there, and nowhere else, with one token granted
`channels.manage`. Ada is an admin of Homelab.

| Caller | Presenting | Asks to | Identity | Credential | Answer |
| ------ | ---------- | ------- | :------: | :--------: | ------ |
| casey | session | delete space Book club | ✓ | ✓ | allowed |
| ops-bot | bot token | delete a channel in Homelab | ✓ | ✓ | allowed |
| ops-bot | bot token | rename space Homelab | ✓ | ✗ | "this token isn't allowed to change this space's settings" |
| ops-bot | bot token | delete a channel in Book club | ✗ | ✓ | refused: ops-bot isn't in Book club, and its own token can't join it |
| ada | personal token, `messages.read` | delete a channel in Homelab | ✓ | ✗ | refused |
| ada, since demoted | personal token, `channels.manage` | delete a channel in Homelab | ✗ | ✓ | refused; nobody revoked anything |
| bea | personal token, every grantable action | change her password | ✓ | ✗ | `account.security` is never grantable |
| uptime (bot) | hook URL for #alerts | post "@everyone disk failing" | – | ✗ | posted; @everyone renders as text |

## Identities

- **`users.kind` is `person` or `bot`.** Authorship, author cards, mentions
  and membership need no special case.
- **A bot never holds an instance role.** Decided 2026-09-13 the other
  way, on the argument that the credential gate makes it safe; reversed
  2026-09-14 once bots existed: it is safe but not useful, since a
  person's own token already carries the server actions, and admin
  standing in every space contradicts the rule that a bot's reach is its
  membership (STOOP-287). Migration 00034 adds the check.
- **Break-glass stays human.** `password_sign_in: admins` honours person
  admins only; a bot never signs in.
- **Only people hold `account.security`.** A bot's credentials are managed
  by an instance admin.
- **Bots are not barred from direct messages** by the model. Whether a bot
  can be messaged is product policy, decided when bot DMs are built: a
  per-bot reachability setting (off by default), disclosure that the bot's
  operator reads what is sent (every participant's messages, in a group
  DM), whether a bot may open a conversation, and how it hears one arrive.
- **Instance-admin inheritance lives in one resolver**, chat's `actorFor`.

## Credentials

| Kind | Holder | Presented as | Grant | Bounds | Minted by |
| ---- | ------ | ------------ | ----- | ------ | --------- |
| `session` | person | cookie, or bearer from the desktop app | everything, including actions added later | none | signing in |
| `personal_token` | person | `Authorization: Bearer stp_pat_…` | listed grantable actions | none: wherever its holder is | its holder, from a session |
| `bot_token` | bot | `Authorization: Bearer stp_bot_…` | listed grantable actions | none: wherever the bot has been put | an instance admin |
| `incoming_hook` | bot | the path of `/hooks/{token}` | `messages.post`, optionally `messages.notify_everyone` | exactly one channel | an instance admin |

- An explicit grant never grows when actions are added.
- `account.security` — passwords, linked providers, minting or listing
  credentials — is never grantable, so a leaked token can't lock its owner
  out or mint itself a successor.
- The token prefix is for people and secret scanners; the kind comes from
  the row. Tokens are 32 random bytes stored as SHA-256, and never ride in
  a cookie.
- Deactivating an identity revokes every credential it holds; revoking a
  credential closes sockets opened with it.
- `last_used_at` is written at most once a minute per credential.
- Personal tokens expire after 30, 90 (preselected) or 365 days; "never" is
  offered behind a warning. The instance setting `personal_tokens` is
  `everyone` (default), `admins` or `off`.
- A password change revokes the person's other sessions and offers "also
  revoke personal tokens", pre-ticked.
- A credential is revoked by its holder or by an instance admin, and nobody
  else. Space admins see a bot's grants and bounds in their space,
  read-only, never the token; removing the bot from the space is their
  lever, since the identity gate then fails there.

### Bounds

A bound row names one space or one channel. Only a hook is minted bounded,
to its one channel. A token's reach is its holder's: every space a person
is in, or every space an instance admin has put a bot in (STOOP-287,
2026-09-14). `Credential.Reaches` and the bounded rules below are
unchanged, and still apply to hooks.

Losing the last bound must not widen a credential: bound rows cascade with
their space or channel, so `credentials.bounded` records the intent, and a
bounded credential with no rows left covers nothing.

A bounded credential never reaches the instance or the caller's own
account, direct messages included: no bound contains them.

### Schema (Access 2, migration 00031)

```sql
CREATE TABLE credentials (
    id           uuid PRIMARY KEY,
    holder_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text NOT NULL
                 CHECK (kind IN ('session', 'personal_token', 'bot_token', 'incoming_hook')),
    token_hash   bytea NOT NULL UNIQUE,
    name         text NOT NULL DEFAULT '',
    grants       text[],                        -- NULL = everything; sessions only
    bounded      boolean NOT NULL DEFAULT false, -- true + no bound rows = covers nothing
    created_by   uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz,
    last_used_at timestamptz,
    CHECK ((kind = 'session') = (grants IS NULL))
);

CREATE TABLE credential_bounds (
    credential_id uuid NOT NULL REFERENCES credentials (id) ON DELETE CASCADE,
    space_id      uuid REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id    uuid REFERENCES channels (id) ON DELETE CASCADE,
    CHECK (num_nonnulls(space_id, channel_id) = 1)
);

ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'person'
    CHECK (kind IN ('person', 'bot'));
```

Live sessions are copied in with their ids and hashes, so nobody is signed
out by the upgrade. `sessions` is dropped a minor later; a rollback loses
sessions created after upgrading, which costs a sign-in. Until the drop,
every revocation clears the matching legacy rows too, so a rollback can't
revive a revoked session.

## Actions

Chat's nine permissions keep their meaning under new names. Reading,
posting and voice are actions too — held by every member, so a credential
can withhold them. Per-channel role overrides stay out.

| Action | Held by | Procedures |
| ------ | ------- | ---------- |
| `instance.read` | instance admin | ListUsers, GetReachability, GetLoginProviders, GetBuildInfo, GetStorageUsage |
| `instance.settings.manage` | instance admin | UpdateSettings, UpdateReachability, UpdateLoginProviders |
| `instance.users.manage` | instance admin | SetUserRole, SetUserActive, ResetUserPassword, RenameUser, SetUsernameFrozen, ClearUserProfile; Register under `closed` |
| `instance.files.manage` | instance admin | SweepFiles |
| `instance.integrations.manage` | instance admin | bots, bot tokens and hooks (STOOP-256) |
| `spaces.create` | admin; members if `space_creation` allows | CreateSpace |
| `spaces.join_any` | instance admin | JoinSpace without an invite |
| `dms.reach_anyone` | instance admin | OpenDirectMessage with someone sharing no space |
| `space.read` | member | GetSpace, ListChannels, ListMembers, GetMember |
| `messages.read` | member | ListMessages, SearchMessages, ListPinnedMessages; space downloads; the space's `/ws` topic |
| `messages.post` | member | SendMessage, EditMessage, ToggleReaction, DeleteMessage (own) |
| `messages.notify_everyone` | admin | modifier inside SendMessage |
| `messages.moderate` | admin | DeleteMessage (others') |
| `voice.join` | member | JoinVoiceChannel |
| `invites.create` | admin; members if the space allows | CreateInvite, ListInvites, RevokeInvite (own) |
| `invites.manage` | admin | RevokeInvite (others') |
| `channels.manage` | admin | CreateChannel, UpdateChannel, DeleteChannel, ReorderChannels, SetMessagePinned |
| `members.manage` | admin | SetMemberRole, KickMember, AddMember, BanMember, UnbanMember, ListBans |
| `space.manage` | admin | UpdateSpace, UploadSpaceIcon |
| `space.transfer` | owner | TransferOwnership |
| `space.delete` | owner, instance admin | DeleteSpace |
| `profile.manage` | person | UpdateProfile, UploadAvatar |
| `preferences.manage` | everyone | mutes, blocks, MarkChannelRead; LeaveSpace, which also needs a session |
| `activity.read` | everyone | ListActivity, MarkActivityRead; granted only together with `messages.read` and `dms.read` |
| `dms.read` | everyone | ListDirectMessages, ListDirectMessageCandidates, DM history |
| `dms.post` | everyone | OpenDirectMessage, posting into a DM (a bot also needs to be reachable) |
| `account.security` (never grantable) | person | ChangePassword, ListIdentities, UnlinkIdentity, provider linking, credential management |

Not actions: public (Register, Login, GetInstanceStatus, LookupInvite) and
any caller (GetMe, Logout, GetUserProfile, ListSpaces filtered to the
credential's bounds). The authoritative map is `internal/app/procedures.go`.

## Enforcement

The credential gate needs no database and runs first, so its refusal says
nothing about whether the resource exists. The identity gate stays in the
module that owns the table it reads.

1. **Auth interceptor** — verify the token; load the credential.
2. **Auth interceptor** — look up the procedure's rule. A test refuses any
   procedure without one.
3. **Auth interceptor** — does the grant cover the rule's action? If not:
   "this token isn't allowed to …".
4. **Owning module** — resolve the resource (a channel to its space).
5. **`authctx`** — do the credential's bounds reach that resource? If not:
   "this token isn't allowed here".
6. **Owning module** — does the identity hold the action there? If not:
   "you don't have permission to …".

A procedure serving both space channels and direct messages names both
actions in its rule; the handler narrows to one once it knows the channel.

Surfaces that aren't Connect calls (Access 5):

- `/ws` accepts a session or a personal token; bot tokens are refused in
  v1. Space topics subscribe only where `messages.read` covers the space.
  The user topic is always subscribed, because it is the control plane
  (joins, revocation), and what it delivers is filtered per credential:
  direct-message events only with `dms.read`, activity only with
  `activity.read`. Typing needs `messages.post` or `dms.post`; a voice
  report needs `voice.join`.
- Every revocation publishes `CredentialRevoked` to the holder's topic;
  the gateway forwards it to the sockets opened with that credential and
  closes them (close code 4001). The gateway also re-verifies the
  credential on every ping, which catches expiry, a setting change and
  anything the bus never carried.
- `/files/{id}` accepts a bearer credential and checks `messages.read` on
  the space, or `dms.read` for a DM attachment. `/files/upload` checks
  `messages.post` or `dms.post` the same way, with chat answering
  membership and bounds.
- Linking a login provider (browser or desktop) needs a session: a token
  can never attach an identity to its holder's account.
- Voice tokens, invites and desktop hand-off codes stay outside the table:
  short-lived tickets minted by a request that already passed both gates
  (`JoinVoiceChannel` needs `voice.join` and a bound that reaches the
  channel's space).

The client stops copying the role table (Access 3): `Space.my_permissions`
and the instance list on `GetMe` replace `web/src/api/permissions.ts`.

## Order of work

| Ticket | What lands | Visible change |
| ------ | ---------- | -------------- |
| Access 1 (STOOP-270) | vocabulary, procedure registry and coverage test, credential gate, bare admin checks replaced | none |
| Access 2 (STOOP-271) | `credentials`, `credential_bounds`, `users.kind` | none |
| Access 3 (STOOP-272) | `my_permissions` on the wire | proto contract |
| Access 4 (STOOP-273) | personal tokens | new feature |
| Access 5 (STOOP-274) | bearer credentials on `/ws` and `/files` | new feature |
| Access 6 (STOOP-275) | webhooks design rebased onto this | plan only |

## Effect on webhooks (STOOP-256)

- Its capability interceptor is this interceptor; its five capabilities map
  onto the vocabulary (`read_messages` → `space.read` + `messages.read`,
  `post_message` → `messages.post`, `notify_everyone` →
  `messages.notify_everyone`, `manage_channels` → `channels.manage`,
  `manage_members` → `members.manage`).
- `bot_tokens` is never created; a hook's token is a credential with one
  channel bound.
- "Bots have no DMs" becomes a per-bot default, enforced in chat's
  reachability check.
- Its migration moves to 00033 (00032 went to `credentials.hint`). The
  rebased design is [webhooks.md](webhooks.md).

## Deliberately not

- **Custom roles or per-channel overrides.** The only per-resource knob is
  a credential bound, and it can only narrow.
- **A policy engine.** The check is a pure function over a table.
- **JWTs.** Credentials stay opaque and revocable with a `DELETE`.
- **An OAuth authorisation server.** Third-party consent would be a fifth
  credential kind; nothing here blocks it or builds it.

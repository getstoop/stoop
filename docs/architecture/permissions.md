# Permissions

Two independent axes, each owned by the module that owns its table:

- **Instance user type** — `users.role`, owned by auth. Who operates the
  server.
- **Space role** — `space_members.role`, owned by chat. What you can do
  inside one community.

**The permission table is fixed in code.** There are no custom roles, no
bitfields, no per-channel overrides. This is a real product decision, not a
missing feature: Stoop is for a group of people who know each other, where
"who can delete a channel" is a question with three plausible answers, not
a matrix somebody has to administer. The fixed table is also a preset we
could build custom roles on top of later without changing what the existing
roles mean.

Status: implemented end to end — roles, enforcement, member management,
instance settings, registration policy, and user administration.

## Instance user type (`auth`: `users.role`)

`admin` or `member`, checked by a database constraint.

An **instance admin** is the server operator, and two things come with it.

**1. The instance itself.** Registration policy, feature toggles, storage
limits, reachability, login providers, and user administration (list,
deactivate, promote, rename, reset a password, clear a profile).

**2. Inherited `admin` on every space on the instance**, whether or not
they are a member — the full space-admin permission set below, plus
`delete_space`, plus the ability to join any space without an invite.

They do **not** inherit `owner`. Ownership only moves by transfer.

Inheritance is a *permission check, not a membership row*. An instance
admin who hasn't joined a space is not listed as a member, does not appear
in the roster, and does not receive its realtime events. This distinction
is what stops "the operator can fix things" from becoming "the operator is
silently in every room".

The trust story is that the operator is one of the group — the friend who
runs the box — not a third party. `vision.md`'s concern is platforms, not
hosts. Where that trust has limits, they are stated where they bite: an
instance admin can open a DM with anyone, but **no RPC lets them list or
read a conversation they are not in**, and a DM attachment is served only
to its uploader and the participants, with no admin bypass. That is an
*application* boundary, and it is honest about being one — DMs sit in
Postgres in plaintext like every other message, readable by whoever holds
the database. End-to-end encryption remains deferred, and
`docs/self-hosting.md` says so to operators in as many words.

**Bootstrap:** the first registered user becomes `admin`. Under the default
registration policy only that first user can register without an invite, so
this is the natural first step of setup rather than a race. The count and
insert run under a Postgres advisory lock, so two simultaneous first
registrations cannot both see an empty table. `stoop admin promote
<username>` is the recovery path.

## Instance settings (`instance`: `instance_settings`)

Settings an admin changes at runtime live in the database, edited through
`InstanceService` and the `/admin` page. The environment either seeds a
setting once or acts as its fallback, depending on the setting — see
[runtime.md](runtime.md#configuration-two-tiers).

| Key | Meaning |
| --- | ------- |
| `registration_policy` | `invite` (default), `open`, or `closed`. |
| `space_creation` | Whether members may create spaces, or only admins. |
| `max_upload_bytes` | Per-file cap, bounded above by the built-in 100 MB. |
| `storage_quota_bytes` | Total upload storage; 0 is unlimited. |
| `password_sign_in` | `everyone` / `admins` / `off`. See [identity.md](identity.md). |
| `login_providers` | The OIDC provider list, replaced whole. |
| reachability keys | Public URL, TURN, Cloudflare TURN, Tailscale, trusted proxies. See [runtime.md](runtime.md). |
| `livekit` | The minted API key pair. See [voice.md](voice.md). |

### The registration policy

| Policy | Meaning |
| ------ | ------- |
| `invite` | **Default.** `Register` requires a valid invite code. An invite is therefore both "join this space" and "you may have an account here". |
| `open` | Anyone who can reach the server may register. |
| `closed` | Only an admin can create accounts. |

Auth consults the policy and redeems invites through consumer-owned ports
(`auth.RegistrationPolicy` ← instance, `auth.InviteRedeemer` ← chat), wired
in `internal/app` like every other cross-module need. This is the one
cyclic pair, closed with a setter after both services exist.

Because `Register` is a public procedure that still receives an identity
when a session is present, an admin creating an account under the `closed`
policy is the *same* procedure behaving differently — not a second
code path with its own bugs.

## Space role (`chat`: `space_members.role`)

`owner` > `admin` > `member`. Exactly one owner per space, enforced by a
partial unique index rather than by application code:

```sql
CREATE UNIQUE INDEX space_members_one_owner_idx
  ON space_members (space_id) WHERE role = 'owner';
```

Ownership is transferable, and the owner cannot leave without transferring
— a space with no owner has no one who can delete it.

| Permission | owner | admin | member |
| ---------- | :---: | :---: | :----: |
| read, send messages, join voice | ✓ | ✓ | ✓ |
| `create_invites` | ✓ | ✓ | if `spaces.members_can_invite` (default off) |
| `manage_invites` (revoke anyone's) | ✓ | ✓ | |
| `manage_channels` (create, rename, set topic, delete, reorder) | ✓ | ✓ | |
| `manage_members` (kick, ban, set role ≤ admin) | ✓ | ✓ | |
| `manage_space` (name, icon, description, welcome, settings) | ✓ | ✓ | |
| `mention_everyone` (`@everyone`, `@here`) | ✓ | ✓ | |
| `delete_any_message` (own messages always) | ✓ | ✓ | |
| `transfer_ownership`, `delete_space` | ✓ | | |

Note what is *not* in that table: reading, sending, and joining voice.
Those need membership and nothing else, and are deliberately not modelled
as permissions — making them permissions would invite per-channel
overrides, which is precisely the complexity being avoided.

### Enforcement

One helper, `requirePermission(ctx, spaceID, perm)` in
`internal/chat/permissions.go`, used by every management RPC in place of a
bare membership check. It:

1. Resolves the caller's **effective role**: the greater of their
   `space_members.role` and the `admin` inherited from an instance-admin
   identity. The instance-admin flag is read from `authctx.Identity`, so
   **chat never imports auth**.
2. Refuses non-members who are not instance admins before the permission is
   even considered.
3. Consults `spaces.members_can_invite` only when it could matter — a
   member below admin asking for `create_invites` — so the common path is
   one query, not two.
4. Answers with a `PermissionDenied` whose message names the action in
   words ("you don't have permission to revoke other people's invites").

The check itself, `allowed(actor, perm, membersCanInvite)`, is a pure
function over a table, which is what lets it be tested exhaustively rather
than through the RPCs.

`Space` carries the caller's effective `my_role`, so the UI hides controls
someone can't use rather than showing them and failing. The server still
enforces; the client is just polite.

## Invites

An invite carries **the role it grants** — `member` or `admin`, never
`owner`.

The grant is capped at the creator's own effective role **twice**: when the
invite is created, and again when it is redeemed. The second cap is the
interesting one. A creator who has since been demoted or has left the space
should not still be minting admins through a code they made earlier, so a
stale admin invite quietly grants `member`. Members who may invite
therefore only ever invite members, at any point in the future.

Validity is evaluated at join time — not revoked, not past `expires_at`
(NULL = never), `use_count < max_uses` (NULL = unlimited) — so expiry needs
no sweeper and a revocation takes effect immediately.

Anyone may revoke an invite they created. **Listing a space's invites needs
`create_invites`**, because seeing live codes is as good as minting them.

## Bans

`space_bans` — kicks that survive re-invite.

`BanMember` needs `manage_members`, follows the same hierarchy as a kick
when the target is still a member (the owner cannot be banned), and may
name someone who has already left. **Every join path consults it**: an
invite redemption, and `JoinSpace` by id for an instance admin.

A kick, a ban and a leave all disconnect the person from the space's
LiveKit rooms as well as deleting the row; see
[voice.md](voice.md#leaving-when-it-isnt-your-idea).

The reason is kept for the people who manage members. The banned person
sees only "removed and can't rejoin" — a moderation note is written for
moderators, and showing it to its subject changes what people are willing
to write.

## Blocks

`user_blocks` — personal, not a space power. Anyone can block anyone;
nobody needs permission to decide who may contact them.

While a block stands:

- Neither side can open or post in a direct message with the other, nor
  edit or react to anything already in it. Deleting your own message
  stays available.
- The conversation is hidden from the blocker's DM list.
- The blocked person's mentions, replies and DMs raise no activity for
  the blocker.

Their messages in shared channels still show. Hiding them client-side is a
later refinement; hiding them server-side would mean rewriting history for
one reader, which breaks reply threading and message counts for everyone
else.

## Where destructive actions live in the UI

Role changes, kicks and bans are all reached from **Space settings →
Members**. The profile card is profile-only: message, block, and a link to
that tab.

This is deliberate. A destructive action belongs next to the copy that
explains it and the list that shows its consequences, not one click from a
hover card where a misclick is cheap.

## Deliberately deferred

Per-channel permissions and private channels. Deleting other people's
messages is already covered by `delete_any_message`, which is the case
those features are usually reached for first.

# Join requests: a form a stranger fills in, and a decision an admin makes

Status: draft 2026-10-06, for review. Nothing here is built.

## What exists

- The only way into a space is an invite code: `JoinSpace(code)` for an
  account holder, `Register(invite_code)` or the provider sign-up for a
  stranger ([architecture/permissions.md → Invites](../architecture/permissions.md#invites)).
  Under the default `invite` registration policy the code is also what
  permits the account, so one invite is both "join this space" and "you
  may exist here".
- An invite is an `invites` row: `code`, `role`, `expires_at`, `max_uses`,
  `use_count`, `revoked_at`. The link is `/join/<code>`; a stranger landing
  on it sees the space's public face through `LookupInvite` (public) and
  the login card offers to create an account.
- Admins admit people directly with `AddMember` (`members.manage`) and
  manage who may not come back with `space_bans`.
- There is no pending state of any kind: nothing a stranger submits is
  stored, and nothing an admin reviews before it takes effect.

## The problem

An admin who wants to grow a space beyond the people they can hand a code
to has one tool: a code with unlimited uses, posted somewhere public. Then
everyone who finds it is in before anyone looks at them, and the only
follow-up is a kick. The admin wants to **look first**: who is this, who do
they know here, why do they want in. Today that conversation happens
somewhere else, and the code still goes out by hand afterwards.

## The shape

**An invite that asks first.** A new kind of invite link, made from the
same dialog, where opening the link shows a short form instead of a join
button. Submitting it makes a **join request** for the space's admins.
Approving a request **mints an ordinary single-use invite** for that
person and admits them through the paths that already exist. Declining
ends it. No account exists until approval, so the anonymous surface gains
a write but not a way to create accounts.

```
  stranger opens /join/<code> ─► LookupInvite says approval_required
         │
         ▼
  form: name, message ─► RequestToJoin (public, rate-limited)
         │                        │
         ▼                        ▼
  /request/<claim>          join_requests row (pending)
  "we'll look at it"              │
                                  ▼
            Space settings → Requests: approve / decline (members.manage)
                 │                                   │
                 ▼                                   ▼
   mint single-use invite,              row → declined; the status
   row → approved                       page says so
                 │
                 ▼
   status page offers "Create your account" → /join/<single-use code>
   → Register / provider sign-up / JoinSpace, exactly as today
```

### Why a link, and why the form sits on the invite

Spaces are not listed anywhere a stranger can see, and that is not
changing here: a space's existence is as private as its welcome text. So
a stranger needs a link, and a link that does something to a space is an
invite. Putting the switch on the invite rather than on the space keeps
everything the admin already knows: it expires, it can be revoked, it has
a use limit, it is listed in the invite modal. One space can have an
open code for friends and an asking code for the forum post at the same
time.

### Why approval mints an invite instead of creating the account

Three paths create an account today (password, provider, admin) and all
run through `checkRegistrationAllowed` and `redeemInvite`, where the
single-use race is already closed (STOOP-140). An approval that created a
pending account would add a fourth, hold a username for someone who may
never arrive, and need a way to delete a `users` row, which the identity
model forbids. A minted invite reuses every one of those paths unchanged,
including the provider cookie's invite intent and the ban check in
`joinWithCode`. The requester still has to come back and pick a username
and password; see **Open questions**.

### Tables

Owned by chat, like invites, members and bans.

```sql
ALTER TABLE invites ADD COLUMN approval_required boolean NOT NULL DEFAULT false;

CREATE TABLE join_requests (
    id            uuid PRIMARY KEY,                       -- UUIDv7
    space_id      uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    invite_id     uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
    user_id       uuid REFERENCES users(id),              -- set when a signed-in person asked
    claim_hash    bytea UNIQUE,                           -- set when a stranger asked
    name          text NOT NULL,                          -- what to call them, 60 chars
    message       text NOT NULL,                          -- their answer, 1000 chars, plain text
    state         text NOT NULL,                          -- pending | approved | declined
    decided_by    uuid REFERENCES users(id),
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL,
    CHECK (state IN ('pending', 'approved', 'declined')),
    CHECK ((user_id IS NULL) <> (claim_hash IS NULL))
);
CREATE INDEX join_requests_space_pending_idx ON join_requests (space_id, created_at) WHERE state = 'pending';

ALTER TABLE invites ADD COLUMN request_id uuid REFERENCES join_requests(id) ON DELETE SET NULL;
```

- **Exactly one of `user_id` and `claim_hash`.** A signed-in requester is
  identified by their account. A stranger gets a claim: 32 random bytes,
  shown once in the status URL, stored as its SHA-256, like every
  credential ([architecture/identity.md → Sessions](../architecture/identity.md#sessions)).
  A database dump therefore holds no live claim that could become an
  invite.
- **`invites.request_id`** points from the minted single-use invite back
  to the request it fulfils, so the invite list can say who it is for and
  redemption can mark the request joined later (phase 2).
- **`invites.approval_required`** is the switch. `use_count` on an asking
  link counts approvals, so "uses" keeps meaning memberships granted.
- **No contact column, no IP.** The limiter sees the IP; the row does not
  need it. A way to reach the requester is an open question below.
- **`message` is plain text**, whitespace-collapsed like a bio, never
  Markdown: the admin list renders what a stranger typed.

### RPCs

All in `ChatService`. Two are public and join the auth rate-limit bucket
(`STOOP_AUTH_RATE_LIMIT`, per IP per minute) beside `LookupInvite`.

| Procedure | Who | What |
| --------- | --- | ---- |
| `CreateInvite` | `invites.create` | Gains `approval_required`. An asking link always grants `member`; `role` is refused with it. |
| `LookupInvite` | **public** | Gains `approval_required` and, when a session is present, `my_request` (state of the caller's request on this code, if any). |
| `RequestToJoin(code, name, message)` | **public** | Makes a request. Signed in: `user_id` set, refused for a member, a banned account or a bot, and once per code while one is pending. Signed out: returns the `claim`, once. Refused when the code is spent, when the space already has 50 pending requests (`ResourceExhausted`), or when the instance's registration policy is `closed` and the caller has no account (nothing could be minted that they could use). |
| `LookupJoinRequest(claim)` | **public** | The status page: state, the space's public face, and when approved the single-use `join_code`. Answers `NotFound` for an unknown claim. |
| `ListJoinRequests(space_id)` | `members.manage` | Pending first, then decided, newest first; 30 days of decided ones. |
| `ApproveJoinRequest(id)` | `members.manage` | In one transaction: consume a use on the asking link, mint a `member` invite with `max_uses` 1 and a 7-day expiry created by the approver, set `approved`. For a signed-in requester, skip the invite and admit them as `AddMember` does (ban check, `publishSpaceJoined`). |
| `DeclineJoinRequest(id)` | `members.manage` | Sets `declined`. No reason field; see **Open questions**. |

`JoinSpace` with an asking code is refused (`FailedPrecondition`, "this
link asks the space's admins first"), so a client that skips the lookup
cannot slip past the form.

A request's state is **not an enumeration oracle**: `LookupJoinRequest`
needs the claim, which only the requester's browser has, and
`RequestToJoin` answers the same way to a stranger whatever the space.

### Events

One new `ServerEvent`, `join_requests_changed { space_id }`, published on
the space topic when a request is made or decided. It carries no content
because a space topic reaches every member and a stranger's message is
for admins only; admins' clients invalidate the requests query and the
pending count, everyone else ignores it. The requester's own outcome
needs nothing new: approval of a signed-in requester publishes
`space_joined` on their user topic as any join does, and a stranger reads
the status page.

### Web

- **Invite modal**: a switch, "Ask me before they join", on the create
  form; an asking link in the list reads "asks first" and shows its
  pending count. A minted single-use invite shows "for <name>".
- **`/join/$code`** (signed in): the page looks the code up first. An
  asking code renders the form in place of the automatic join; after
  submitting, the same page says the request is in, and on a later visit
  `my_request` says where it stands.
- **The login card's invite landing** (signed out): under `InviteHero`,
  an asking code shows the form instead of the register and sign-in
  forms. The hero already tells the stranger what they are asking to
  join. A returning account holder gets a "sign in first" link, which
  brings them back to `/join/$code` with a session.
- **`/request/$claim`** (public, outside the shell's guard like `/login`):
  the status page. Pending: "Keep this page; check back." with a check
  button and no polling. Approved: "You're in. Create your account." to
  `/login?redirect=/join/<single-use code>`, or "Sign in and join" for a
  returning account holder. Declined: one line, no reason.
- **Space settings → Requests** (`?tab=requests`, `members.manage`): a
  `DataTable` of pending requests with name, message, when, and approve
  and decline buttons, then the decided ones dimmed. The tab label
  carries the pending count. Decline asks for confirmation; approve does
  not, since the admin can revoke the minted invite from the invite
  modal if they change their mind before it is redeemed.

### Abuse

The form is the first anonymous write surface after `Register`. What
bounds it:

- The auth rate-limit bucket per IP, shared with `Login` and `Register`.
- At most 50 pending requests per space; the 51st is refused until an
  admin decides some. A flooded admin revokes the link, which refuses
  further requests and leaves the pending ones to be decided or swept.
- Pending requests older than 30 days and decided ones older than 30
  days are removed by a `sweep_join_requests` job on the existing runner,
  on the file sweep's interval. A stranger whose status page says
  "not found" after a month asks again.
- A signed-in account gets one pending request per code. A stranger
  cannot be told apart from another, so nothing stops them submitting
  twice from two browsers; the limiter and the cap are the bound.
- The minted invite expires in 7 days. An approved stranger who never
  turns up leaves no account and no row that needs cleaning beyond the
  sweep.

## Phases

1. **The flow end to end.** Migration, the six RPC changes, the form on
   both landings, the status page, the Requests tab, the event, the
   sweep. Signed-in and stranger requesters both. Browser spec: a
   stranger requests, an admin approves, the stranger registers through
   the status page and lands in the space; a second stranger is declined
   and sees it.
2. **Closing the loop.** Redeeming a minted invite marks the request
   `joined` with the account that joined, so the Requests tab reads
   "joined as @casey". A pending count on the space's settings link in
   the rail for admins. Desktop banner for admins on a new request, if
   the activity feed grows a kind for it; that is a schema change to
   `activity_items` (`channel_id` and `actor_id` are `NOT NULL`) and gets
   its own decision.
3. **Per-space question.** `spaces.join_prompt`, shown above the message
   field instead of the default "Tell us who you are and how you found
   this space."; edited from Space settings → About.

## Open questions

1. **Reaching the requester.** Stoop has no mail, so a stranger learns of
   approval only by returning to the status page. A free-text "how can
   we reach you" field (200 characters) would let the admin say so
   somewhere else, at the cost of storing a stranger's handle on another
   service. Recommendation: leave it out of phase 1 and see whether
   admins ask; the people a small community admits usually already know
   someone in it.
2. **A reason on decline.** Bans keep their reason for moderators because
   a note written for its subject reads differently. A decline note
   would be written *for* the requester, so the argument does not carry,
   but it is also a channel from an admin to a stranger. Recommendation:
   no note in phase 1; declined is one line.
3. **Who may approve.** `members.manage` is the natural fit (owner and
   admins) and needs no new action. A space where members may invite
   could reasonably let members approve too, since approving is a
   narrower power than minting an open code. Recommendation: admins only
   until someone needs otherwise.
4. **Requester's username and password at request time** would save the
   return trip: approval would create the account. It was ruled out
   above for holding usernames and needing account deletion; it is
   listed because it is the thing people will ask for first.
5. **`my_request` on `LookupInvite`** keeps the signed-in requester's
   view to one call but puts caller-specific data on a public procedure.
   `Register` already behaves differently with a session present, so
   there is precedent; the alternative is a `ListMyJoinRequests` call.

Stoop 0.19.0

Stoop 0.19.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.18.0, and `stoop upgrade rollback`
takes it back: its one migration only adds, so 0.18.0 starts against the
result.

**What's in it.**

- **Invites join people as members.** An invite link gets forwarded and
  pasted, so it no longer carries admin. Make someone an admin from
  Space settings → Members once they have joined. An admin invite made
  before this release still works until it is spent, capped at its
  creator's current role as before, and the list and the sign-in
  preview still say "joins as admin" on it.
- **Invites have their own page.** "Invite people" in the space menu
  opens Space settings → Invites instead of a dialog. It is a table like
  Members and Banned: each invite shows its label over its code, who
  made it, its uses and when it runs out, with Copy link on the row and
  Copy code and Revoke in its menu. Revoked, expired and used-up
  invites stay behind a "Show spent" switch. New invite opens a dialog
  with a label (optional, up to 60 characters), an expiry and a cap on
  uses; the link goes to the clipboard when the invite is made.
- **Labels, and who joined.** A label says what an invite is for
  ("Tuesday book club"); only the people who can list invites see it,
  never the person joining. Opening a row lists who joined through that
  invite and when. Joins from before this release were not recorded,
  so older invites start with an empty list.
- **Members see only their own invites.** In a space where members may
  invite, a member gets the Invites page scoped to the invites they
  made. Before, they saw every live code in the space. Admins and the
  owner see everyone's, with a Created by column.
- **Space settings → General is one form.** The space's name,
  description, welcome and its two switches ("Members can create
  invites", "Voice channels") apply together with Save changes at the
  bottom; until now the switches applied the moment they were clicked
  and the name had its own Rename button. The About tab is gone: the
  description and welcome are on General, and an old `?tab=about` link
  opens General. The icon still applies as soon as it uploads, and the
  page now shows it.
- **The welcome is written in the composer's editor**, with the same
  formatting toolbar and shortcuts as a message, instead of a Markdown
  box with a Preview button. Members read it exactly as before.
- **A space's icon outside the rail** (the settings header, the welcome
  pane, About this space, the invite sign-in page) is a rounded square,
  the way the rail draws the open space, and no longer reacts to hover.

**For operators.**

- **Expand migration.** 00073 adds `invites.label` (text, defaulting to
  empty, at most 60 characters) and the `invite_uses` table. The floor
  stays at 70. 0.18.0 never reads either, so `stoop upgrade rollback`
  returns to 0.18.0; joins made while rolled back are not recorded in
  `invite_uses`.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `CreateInvite` refuses any role other than unset or `MEMBER` with
  `InvalidArgument`, instead of granting admin. The field stays on the
  wire for older clients. It takes an optional `label`.
- `ListInvites` returns every invite to the space only to a caller with
  `invites.manage`; anyone else with `invites.create` gets their own.
  Each invite now carries `label` and `creator`, the latter set by
  `ListInvites` only.
- New: `ListInviteUses` lists who joined through one invite, newest
  first. The invite's creator may call it; anyone else needs
  `invites.manage`.

**Schema.** Migration 00073 takes the schema from 72 to 73; the floor
stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.18.0.

**Known issues.** As 0.18.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load; older pages of the
Activity page do not refresh when items are read elsewhere, and in a
narrow race an activity item coalesced just as it is read can come back
unread. New: the welcome editor cannot stop typing at the 4,000-character
limit, so its counter turns red past it and Save is refused.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.18.0:

- Invites: every invite joins people as a member (c351f035)
- Invites: a label, who joined through one, and a list shaped by role (a5b6fefe)
- Invites: review follow-ups (1250d7a2)
- Invites move to Space settings → Invites (7f7f7455)
- Invites: the login preview still says you'll join as member (095f125b)
- Invites page: review follow-ups (52968743)
- Invites: review follow-ups from the PR (d1aa50c8)
- Invites page: review follow-ups from the PR (265a3c25)
- Invites page: Expires is the moment itself (4997cf9c)
- Space settings → General: one form with one Save (477c591d)

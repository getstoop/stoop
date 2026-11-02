Stoop 0.20.0

Stoop 0.20.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.19.0, and `stoop upgrade rollback`
takes it back: there is no migration, so 0.19.0 starts against the same
schema.

**What's in it.**

- **Activity: deleted messages leave the inbox.** When a message with an
  activity item is deleted, the item used to stay in the feed and in the
  badge until the page was reopened. The inbox now refreshes itself when
  a delete could have taken something it holds, whether the message was
  deleted outright, became a tombstone because its thread still has
  replies, or went with Delete thread.
- **Activity: Mark all read reaches every loaded page.** It used to
  stamp only the first page, so rows loaded by scrolling stayed in New.
- **The rail's unread marker is a tab on the pill's edge**, toward the
  channel sidebar, instead of a dark square on the icon's corner. On the
  open space it stretches into a short line. A space shows the tab for
  anything unread and the red count on top of it when there are
  mentions; before, it drew one or the other. Direct messages keep the
  count badge alone.
- **Skeleton rows at a channel's loading edges.** While an older or newer
  page is on its way, the edge draws three placeholder rows the shape of
  a message instead of a line of muted text that was easy to miss.
  Landing from the "New messages" line no longer nudges the viewed row
  by the height of the head.
- **Profile: a name stored with a stray space is not an edit.** A login
  provider can store a display name with a trailing space, which made an
  untouched profile form count as changed and lit Save. Save now stays
  off until something is edited, and an edit to another field sends the
  name trimmed.

**For operators.**

- **No migration.** The schema stays at 73 and the floor at 70.
  `stoop upgrade rollback` returns to 0.19.0 with nothing to undo.
- **Security fix in a dependency.** `go-jose` moves from 4.1.4 to 4.1.6
  for GHSA-mgcc-cww5-fp2q: JWK parsing now caps the RSA modulus it
  accepts at 4096 bits. Stoop uses the library indirectly, through
  Tailscale, and sets no larger limit.
- **Other dependency moves.** Tailscale 1.102.5 → 1.104.4, Connect
  1.21.0 → 1.21.1, goose 3.28.0 → 3.29.0, `golang.org/x/net` 0.59.0 →
  0.61.0, and the web app's React 19.3.1, Connect 2.3.0 and
  livekit-client 2.23.0. None changes behaviour an operator configures.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `DirectMessage` carries `last_message`, a new `DirectMessageLast`: the
  newest message's id, author, a one-line plain-text preview, whether it
  was deleted, and when it was sent. Every RPC that returns a
  `DirectMessage` fills it. It is unset for an empty conversation and
  for a credential without `dms.read`. The field is additive; the web
  app ignores it, and the phone app's Messages tab reads it.

**Schema.** Unchanged at 73; the floor stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.19.0.

**Known issues.** As 0.19.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load; older pages of the
Activity page do not refresh when items are read elsewhere, and in a
narrow race an activity item coalesced just as it is read can come back
unread; the welcome editor cannot stop typing at the 4,000-character
limit, so its counter turns red past it and Save is refused. New: an
Activity row on an older page whose message is deleted while the inbox
is open stays until the inbox is reopened.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.19.0:

- Bump docker/login-action from 4.6.0 to 4.7.0 in the actions group (18f7371d)
- Activity: the feed's rules move to core for the phone (a1a2f192)
- Mobile: the Activity tab (07c94f96)
- Activity: deleted messages leave the feed, Mark all read reaches older pages (2f6ed69b)
- DMs: naming and counting rules move to core for the phone (2240cbd8)
- DMs: each conversation carries its newest message (4c15de82)
- DMs: the newest-message line needs dms.read and skips a raced delete (b99e38da)
- Mobile: the Messages tab (09ee828b)
- Messages: a row's day counts by the calendar; an unnamed sender gets no colon (e3795106)
- Mobile: track presence, and show it on one-to-one Messages rows (1ac616f3)
- Mobile: the conversation screen (screen 12) (09d70e50)
- Conversation flow: open the thread before the keyboard is up (825d31a1)
- Mobile: New message (screen 11) (f47337a9)
- Mobile: a long press on a conversation opens its menu (7551f42d)
- Mobile: swipe a conversation left to close it (44899237)
- Messages: a closed row slides away and the list closes up behind it (ea10bf95)
- Bump the go group with 5 updates (bd5fa37a)
- Bump the web group in /web with 20 updates (6fe065ed)
- You tab: who you are, this phone, and a confirmed sign out (9f4ad3c5)
- You tab: every server on the phone, and a way to remove one (5389b6e7)
- You tab: edit your name, username, pronouns and bio (d5139957)
- You tab: change your avatar from the phone (db3af7cb)
- You tab: keep Remove hidden while a server row is pressed (86c39781)
- Mobile: bring the reader to their message after sending from further up (769461f1)
- Composer: keep the attach sheet open when the card becomes the pill (0063482a)
- STOOPMOBIL-18: a refused send keeps the screen (ba7d5460)
- Mobile: read a channel's activity once per look, not once per row (e27d08d8)
- Mobile: regroup the channel's rows only when what they read changes (39b595de)
- Mobile: show that posting is closed in announcement channels (6764a068)
- Bump node-forge from 1.4.0 to 1.4.2 in /mobile (ee3d34c1)
- Mobile: move the channel's read rules where a test can hold them (84c0eb0b)
- Mobile: say the draft goes too when posting closes (84388030)
- Mobile: cover the rest of the read rules, and say what readPass holds (927c1dba)
- Mobile: a failed page waits, and offers a retry (3e5a0891)
- Mobile: a page refused for good doesn't offer a retry (f1ef7b5d)
- Mobile: a keychain read that fails is not an empty server list (ffbd1c0f)
- Web: skeleton rows at the channel's loading edges (bc7ffe2f)
- Mobile: a sign-in to a saved server starts its session afresh (0d081fa3)
- Web: a page's landing keeps the viewed row put under a taller head (6f10208e)
- Mobile: a list that won't save takes the new token back out (eae4e2b0)
- Mobile: a reply's activity item is read with the thread on screen (16721b2d)
- Mobile: the thread and channel headers keep their options between renders (61aade6b)
- Mobile: a presence change re-renders only the rows it changes (810ceb3a)
- Mobile: adding or removing a server leaves the other sockets alone (be7b536f)
- Mobile: no MarkThreadRead after the reader's own reply (797af687)
- Mobile: thread and channel share what they had written twice (02fc2b45)
- Mobile: You skips foreground and socket reloads while off screen (b3bb0e3c)
- Mobile: You and Edit profile share one signed-in profile load (45b43f9a)
- Mobile: a socket told its session has ended stops reading the keychain (840d825e)
- Mobile: commit a test for what a new sign-in guarantees (5f0d8896)
- Web: the rail's unread marker is a tab on the pill's edge (2cf8009e)
- Bump github.com/go-jose/go-jose/v4 from 4.1.4 to 4.1.6 (8c0c2e65)
- Bump @vitejs/plugin-react from 5.2.0 to 6.1.2 in /web (0bcf57e5)
- Mobile: stop redialling an ended session, and say so at once (5f5a3b75)
- Bump @types/node from 22.20.2 to 25.9.9 in /web (5de4a8b2)
- mobile: give "Sign in again" a way back (054bc10a)
- Mobile: only the server's own 401 ends a session, and never an open socket (38a1247d)
- Mobile: reflow the socket's comment on the session check (e9959ad9)
- mobile: count direct messages in a server's badge (bcb38487)
- mobile: pin the failed token read, name the badge among alertingCount's uses (a2989af2)
- mobile: ask before Edit profile drops unsaved edits (a5995954)
- core: a stored display name's stray spaces aren't an edit (cf2c0bc5)

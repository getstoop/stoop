Stoop 0.21.0

Stoop 0.21.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.20.0, and `stoop upgrade rollback`
takes it back: its one migration only adds an index, so 0.20.0 starts
against the result.

**What's in it.**

- **Badges count what is addressed to you, however old.** The badge on a
  channel, on a space and on the desktop dock and tray was counted from
  the newest fifty items of the activity feed, so an older mention got
  no badge and sixty showed as fifty. The server now counts them: every
  mention of you and every reply to a message of yours that is past
  your read marker, from someone you have not blocked, outside anything
  you muted. Reading a channel does not clear a mention in a reply that
  only its thread shows; that one stays until the thread is read.
- **Activity: New holds everything the header counts.** An unread item
  older than the first page used to leave the header saying "1 unread"
  over an empty New until you scrolled far enough. The inbox now loads
  older pages by itself until New has them all, up to ten pages.
- **Activity: a conversation that picks up again moves to the top.** A
  direct message conversation or a thread keeps one entry while unread,
  and a further message used to leave it where the first one put it. It
  now sorts by its newest message. Desktop banners follow: one per
  conversation, each message replacing the last.
- **Activity: a message you were already looking at arrives read.** A
  mention or reply that landed in the channel or thread on screen could
  appear in the inbox as unread. The page's button now reads the feed
  and nothing else, and says "Mark activity read".
- **Drafts stay in their conversation.** What you have typed and not
  sent is kept under the channel, thread or direct message it was typed
  in, so switching away, a reload or an ended session no longer loses
  it, and a send that fails after you have left goes back to where it
  was written. A draft lives in the browser and nowhere else: it is not
  sent to the server, does not follow you to another device, goes after
  7 days untouched, and is deleted by Log out, Log out everywhere and
  Delete account.
- **The side panel can be resized.** Drag its left edge, or use the
  arrow keys on it; Home or a double-click puts it back. The width is
  kept per browser. In a narrow column a message's date trims instead of
  wrapping onto a second line.
- **Avatars are rounded squares** instead of circles, and the rail's
  presence dot sits in the corner. Space icons in the rail stay round.
- **The user card leads with one button.** Message fills the row, and
  Copy mention, the settings link a manager gets, and Block wait in a
  menu beside it. Your own card leads with Edit profile.
- **Activity rows** put "mentioned you · #general · The Stoop" on its own
  line under the name, and the page's header says what the page is.
- **The replies line** under a thread's root sits on the panel's surface
  with no border, and steps up when pointed at or open.

**For operators.**

- **Expand migration.** 00074 adds the index `messages_author_idx` on
  `messages (author_id, id DESC)`, which the badge counts read. It is
  built during the upgrade, so an instance with a large `messages`
  table takes a little longer to come back than usual. The floor stays
  at 70. 0.20.0 ignores the index, so `stoop upgrade rollback` returns
  to 0.20.0 with nothing to undo.
- **No dependency moves** in the server or the web app. Only the
  build's GitHub Actions were bumped.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `Channel` carries `alert_count`: the caller's messages past their read
  marker that are addressed to them, by the rules above. `ListChannels`
  fills it. It is always 0 for a direct message, where `unread_count`
  is the number that matters, and it is never set on broadcast events.
- `Space` carries `alert_count`, the sum over its channels, filled by
  `ListSpaces`. Both fields are additive.
- An activity item whose message the recipient's read marker has already
  passed is created with `read_at` set, and its event carries it.
- An unread direct message or thread entry in the activity feed takes a
  new id each time a further message refreshes it. `MarkActivityRead`
  with the old id is a no-op, as it is for any id that is gone.

**Schema.** 74, from 73; the floor stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.20.0.

**Known issues.** As 0.20.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load; older pages of the
Activity page do not refresh when items are read elsewhere, and in a
narrow race an activity item coalesced just as it is read can come back
unread; an Activity row on an older page whose message is deleted while
the inbox is open stays until the inbox is reopened; the welcome editor
cannot stop typing at the 4,000-character limit, so its counter turns
red past it and Save is refused. New: after a block or unblock made in
one tab, the badges in another open tab can stay as they were until
that tab is reloaded.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.20.0:

- Docs: propose keeping drafts on mobile (dd8b2485)
- proto: alert_count on Channel and Space (a94b51ce)
- chat: count alerts from the read markers (5615451f)
- docs: badges come from the alert counts (f2c08733)
- chat: alert count tests that reach the access and placeholder rules (e19f3d33)
- chat: an activity item behind the reader's marker is born read (13e942f8)
- chat: pin the born-read rule's channel-arm guards (88c8c3e7)
- web: badges read the alert counts (57aed8ab)
- e2e: badges that count past the feed's first page (cdecd042)
- docs: web badges come from the alert counts (a7bc02c8)
- web: alert counts after a block, a leave, a blocked author's mention (e0adff41)
- mobile: space and channel rows read the alert counts (3468f701)
- mobile: pin messageUpdated in the Space reload test (7a0cb1ec)
- mobile: the channel screen reads no feed items (03637eb9)
- mobile: badges read the alert counts (8d204928)
- core: drop the feed-counting helpers (f45249bd)
- mobile: the thread screen stops re-reading for late items (306c8a14)
- mobile: the channel screen stops re-marking for late items (1883d873)
- mobile: threadReadDue's comment names the reads that are left (972f4bbd)
- web: alert bookkeeping holds up on a cold cache and an unheld thread (30b0643c)
- web: an unheld thread root asks for the lists through the in-flight helper (8c2af8c5)
- Activity: load older pages until New holds everything counted (3b2eef80)
- Activity: harden the automatic page loads (60856d37)
- Refreshed feed entries take a new id so they sort as new (6d6c8553)
- Serialise coalescing writes per channel; key banners by entry (328bd7c8)
- Mint coalescing ids under the lock (ac607c73)
- Keep a late read arrival; prune older pages against the current page (6441500a)
- Activity: the verb and place on a line under the name; a blurb in the header (868674d5)
- Side panel: drag its left edge to set its width; message dates trim, never wrap (07e0b1d6)
- Avatars are rounded squares; the rail's presence dot sits in the corner (dcd11247)
- User card: Message is the button; the rest wait in a menu (f24a72a9)
- Mobile avatars are rounded squares, matching web (4fe965d0)
- User card: your own card leads with Edit profile (98e48355)
- An xl radius for the biggest avatar (e57e71f6)
- Carry the side panel floor into the generated mobile theme (d1211354)
- Mobile: the fade behind the composer eases out over the whole pill (b83d3093)
- Mobile: the composer sits a little lower over the home indicator (5545dd0c)
- Mobile: the list's ends blur where iOS has Liquid Glass (da9b9365)
- Mobile: the foot's edge keeps one height under the keyboard (4c976560)
- Mobile: no foot edge while the keyboard is up (8fd568d7)
- build(deps): bump the actions group with 3 updates (c56b8572)
- Docs: the drafts proposal covers every client (2f7cb630)
- Drafts: the shared rules in core and the web store over localStorage (5ea655ac)
- Docs: drafts read synchronously on mobile, and the backup check's answer (0f797a00)
- Mobile: a store for drafts on the device (a9097861)
- Web: drafts stay in their conversation (2b5a47ea)
- Mobile: drafts stay in their conversation (7c39e5da)
- Web: a shown draft that matches the store counts as saved (7a7e68b3)
- Mobile: a shown draft that matches the store counts as saved (e4730277)
- Mobile: a page the server refuses reads as gone (b3731914)
- Docs: drop five built proposals, and say what the code does now (436dee21)
- Docs: the channel log record moves beside the architecture docs (3366f37c)
- Mobile: activity rings as a system notification while the app is in front (c7d3a2fa)
- Mobile: a notification asks again whether to stay quiet before it shows (872df21d)
- Mobile: a tapped notification opens its message, and reading clears it (c01446fb)
- Mobile: the tap's decision is a pure function, and review follow-ups (d0687e48)
- Mobile: the app's icon carries what waits on every saved server (b8f04e6d)
- Mobile: the icon badge's review follow-ups (2ee7e047)
- Mobile: closing what is over the server pops from the screen in front, and an ended session rings nothing more (16917f04)
- Mobile: say plainly what the pop's source and the live flag are for (58d31bc4)
- Mobile: a keychain that can't be read keeps the badge's last total (9a49f94b)
- Mobile: the app wears the Stoop icon (59fca4a5)
- Brand: rewrap the mobile icon comment (62a79bbc)
- Mobile: direct messages badge the Messages tab, not Activity (51487317)
- Mobile: badge comments and tests after review (a223ce9b)
- Mobile: no mention tint, a pencil for Edit, bar buttons in the theme's scheme (e6887da7)
- Mobile: the You tab's Edit button is its word again (e437fb2b)
- Mobile: title pills fill the bar, mention glyphs; web: replies line on its own surface (4b4ec456)

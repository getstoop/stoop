Stoop 0.22.0

Stoop 0.22.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.21.0, and `stoop upgrade rollback`
takes it back: its three migrations only add, so 0.21.0 starts against
the result. What 0.21.0 makes of the new rows is under "For operators".

**What's in it.**

- **A channel records what happens to it.** A rename, a new or cleared
  topic, announcement mode switched on or off and a pinned message each
  leave a line in the channel's timeline, in place among the messages:
  who did it, what changed and when. A line is not a message: it has no
  avatar, reactions, replies or thread, and nobody can edit it.
- **Private channels record who joins and who goes.** Adding people
  writes one line naming them ("joined" when an admin adds themself),
  and a long list folds to "N others", which unfolds in place. Leaving
  writes "left". Being removed from the channel, leaving the space, a
  kick, a ban and a deleted account all read as "left" too: nothing
  says who removed someone or why, so a ban is not announced in every
  channel the person was in. Public channels record no joins or leaves,
  since everyone in the space is in them. Making a private channel
  records nothing either.
- **These lines never mark anything unread.** They are left out of
  unread counts, badges, the Activity page and desktop banners, a
  channel's preview never shows one, and the "New messages" line sits
  above the first unread message someone wrote. Search does not match
  them.
- **A pin's line goes to its message.** "pinned a message" carries an
  excerpt and View, which jumps to the message even when it is far up
  the channel. Unpinning writes nothing. Deleting the message removes
  its pin lines with it.
- **Only admins and the owner can delete one of these lines**, with its
  own confirmation. Causing a line gives no right to delete it. The
  usual reason to delete one is the text it holds (a topic, a channel
  name), so the server forgets that text when it goes. Nobody can
  delete one in a direct message.
- **Clicking a desktop banner no longer ends a voice call.** The click
  used to reload the page it pointed to, and the call lives in the
  page. It now changes the view and leaves the call running.
- **Icons have rounded corners** where the platform draws them as given:
  the Windows app and tray icons, and the web app's installed icon.

**For operators.**

- **Expand migrations.** 00075 and 00076 add the `push_keys` and
  `push_subscriptions` tables. 00077 adds four columns to `messages`
  (`kind`, `data`, `quiet`, `reference_message_id`) with two checks, a
  foreign key and a partial index, and extends the `message_with_reply`
  view. The checks and the foreign key each read every message once and
  rewrite nothing: 0.37 s for the table and 0.09 s for the index at two
  million messages on a laptop, so a large instance takes a little
  longer than usual to come back. The floor stays at 70.
- **Rolling back to 0.21.0** needs nothing undone, but 0.21.0 does not
  know the new lines. The ones already written show as empty messages
  from the person who caused them, count as unread, and can be edited
  by that person. Back on 0.22.0, a channel whose last message 0.21.0
  set to one of them shows its space as unread beside a count of zero
  until someone posts there or marks the channel read.
- **Push notifications, server side only.** The server can now send a
  mention, a reply, a direct message or a thread reply to a registered
  device as an encrypted Web Push message, signed with a key pair it
  makes on first use and keeps in `push_keys`. No released client
  registers a device yet, so on an upgraded instance nothing is sent
  and the server makes no new outbound connections. There is no
  setting for it. The Diagnostics tab gains a `push` row, off while no
  device is registered.
- **Background jobs.** Push deliveries share the cap outgoing webhook
  deliveries already had: together they take at most three quarters of
  `STOOP_JOBS_WORKERS`, and each kind at most half of that, so a
  backlog of one never shuts out the other.
- **Outgoing webhooks never deliver one of the new lines.** A hook can
  still receive a `message.deleted` for an id it was never sent, when a
  moderator deletes a line or a pinned message's lines go with it. A
  receiver should ignore a delete for an id it does not hold. Adding a
  hook's bot to a private channel now shows there as "added", and
  removing it as "left".
- **Bots and personal tokens that read history** (`ListMessages`,
  `ListChanges`) receive the new lines in their places, with `event`
  set and no text, and should skip what they do not want.
- **No dependency moves** in the server or the web app. Only the
  build's GitHub Actions were bumped.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `Message` carries `event`, a `SystemEvent` with one case per kind of
  line (`members_added`, `member_left`, `channel_renamed`,
  `topic_changed`, `pin`, `post_policy_changed`); `quiet`, set on a row
  that marks nothing unread; and `reference`, the message the row is
  about, as a reply's quote is sent. The server sends no wording:
  `content` is empty and the client builds the sentence. A client that
  meets a case it does not know hides the row when `quiet` is set and
  otherwise asks the reader to update.
- A row with `event` set refuses edits, reactions, replies, quotes,
  threads, pins and link preview dismissal with `FailedPrecondition`.
  Deleting one needs `messages.moderate`, whoever caused it.
- `UpdateChannel`, `AddChannelMembers`, `RemoveChannelMember`,
  `LeaveChannel`, a pin and every way of leaving a space are now
  followed by a `message_created` for each line they record, after
  their own event. `channel_updated` also reaches the people in a
  private channel on their own topics.
- `GetSpace` fills `Space.muted`, the caller's own mute of the space.
  Only `ListSpaces` did.
- New: `stoop.push.v1.PushService` (`GetPushConfig`,
  `RegisterPushSubscription`, `UpdatePushSubscription`,
  `DeletePushSubscription`), one Web Push subscription per signed-in
  session, removed with the session. A token is refused.
- `activity_item_created` carries `user_id`, the recipient. Additive.

**Schema.** 77, from 74; the floor stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.21.0.

**Known issues.** As 0.21.0's: deleting a message above the part of a
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
red past it and Save is refused; after a block or unblock made in one
tab, the badges in another open tab can stay as they were until that
tab is reloaded. New: when the retention sweep removes a pinned message,
an open tab keeps showing its pin line's excerpt until it is reloaded;
taking someone out of a space can fail with an error when it collides
with another change to the same channels at the same moment (trying
again works), and a ban that fails this way leaves the person banned
but still a member until the ban is made again.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.21.0:

- Mobile: Notifications screen with do not disturb (78ee56d7)
- Mobile do not disturb: order calls per server, say when the end passes (55d8bfc4)
- Mobile Notifications: choose which kinds alert, and hide message text (a4e749b8)
- Mobile notification kinds: tidy content options, share the switch type, README wording (18efca31)
- Mobile Notifications: choose which servers alert, and say when the system has refused (8a68ea7b)
- Mobile Notifications: count an ask this run as a refusal, quieter screen readers, README list fix (b68c4fe9)
- Mobile Notifications: thread replies alert by default (1ee1a985)
- Mobile: space icon shows two letters like web (8f566abe)
- Mobile Spaces: the rail and the selected space's channels on one screen (37228737)
- Mobile Spaces: review fixes for the rail and pane (43793797)
- Mobile Spaces: open on the space last picked on each server (405ee83d)
- Mobile Spaces: place the rail at its first usable height (d16f58cf)
- Mobile Spaces: the rail's unread tab on the right edge, as web (c49f6b47)
- Mobile Spaces: the selected bar on the rail's right edge too (36a97caf)
- Mobile: one menu sheet for rows, shared by the conversation menu (da30ff91)
- STOOPMOBIL-35 Mobile Spaces: long-press a channel for its menu (5d7d0853)
- Mobile Spaces: the space's mute from the rail's list, and review fixes (d99af693)
- Mobile: the sheet's shell on its own, under the menu sheet (63f198d3)
- STOOPMOBIL-35 Mobile Spaces: About this channel (5be2cfa8)
- Mobile Spaces: review fixes to About this channel (2f855d5b)
- Mobile: the menu sheet measures its own safe area (d789840c)
- Mobile Spaces: a topic scrolls by its height and the window's now (56bd648f)
- Mobile Spaces: a muted voice room shows it (d8dfd4e3)
- Mobile Spaces: review tidies to the voice room's mute comments (b8f7245e)
- build(deps): bump the actions group with 2 updates (95487bce)
- Mobile Spaces: the rail's mark grows into the selected bar (2f21b7cb)
- Mobile: a make target for a release build on a connected iPhone (a1867eec)
- Mobile sheets: the scrim and the sheet come in together, on a settling curve (ab93d721)
- Mobile sheets: a gentler start to the way in, and the hook's comment (67ef11d2)
- Mobile sheets: the drag is the system's, and reaches above the sheet's edge (3e1352a9)
- Mobile sheets: review fixes to the drag (1ff9e769)
- Mobile: the composer rides the keyboard frame by frame (aafba2dd)
- Mobile keyboard: review fixes (f73a1bf8)
- Mobile sheets: Copilot's points on the drag (484555b1)
- Mobile Spaces: the pane fades in as a space is picked (7f0dd403)
- Mobile Spaces: review fixes to the pane's fade (c19043ec)
- Mobile Spaces: a space picked again shows its channels at once (d50b332c)
- Mobile keyboard: Copilot's points on the scroll to a quoted row (af89051a)
- Mobile Spaces: review fixes to the kept channels (a8492fa9)
- Mobile composer: the pill opens into the card (6132fc3f)
- Mobile composer: review fixes to the frame (7a816573)
- Mobile: open shared links handed over by the web's open-in-app page (76ecd484)
- Mobile: reload the spaces once before giving up on a linked space (a2d1c8c6)
- Mobile: an overtaken spaces reload waits for the one that took its place (5416cda7)
- Mobile: a server chip by the tab bar opens the server switcher (df556067)
- Mobile server chip: review fixes (d5382546)
- Mobile: the tabs lose their server header; the chip is the way to the switcher (18829250)
- Mobile server header removal: review fixes (a62526c9)
- Mobile: New message is a pencil over a square; a conversation's face clears its pill's end (374655c0)
- Mobile: emoji draw in the iOS composer (5fc6c2b9)
- Mobile: Add a space, a sheet for joining one with an invite link (eb707ad6)
- Mobile Add a space: review fixes (74625189)
- Mobile Add a space: an invite to a space you're already in (12c978ef)
- Mobile Add a space, already in: review fixes (1b0a6c65)
- Mobile Add a space: an invite link for another server (120d7910)
- Mobile Add a space, another server: review fixes (bbab024b)
- Mobile: an invite opened from the web takes Add a space when the server is saved (a9c14bfc)
- Mobile invite hand-over: review fixes (a152b4ad)
- Mobile invite hand-over: dismiss New message once (d62142ed)
- Mobile rail: Add a space is the icon alone, larger and in the accent colour (5fb25441)
- Mobile rail: Add a space keeps an outline, solid and in the accent colour (6e739348)
- Mobile invites: a notice that an invite can't be used is read out (9ff18e33)
- Mobile invites: announce the notice's words (6077ea91)
- Mobile Add a space: a long name fits the button, and the rail's reveal honours Reduce Motion (60e849cf)
- Mobile: make mobile-android-release, a release build onto a connected Android phone (5070b7ba)
- Mobile: Android fixes from the first pass on a real phone (e2a40eac)
- Mobile: a keyboard's height is never under 0 (b2ba524b)
- Mobile: no shadow on the header's pills on Android, and the pill sized as it was (afa16ed1)
- Mobile: one floating header for a channel, a conversation and a thread (25d6a0c4)
- Mobile header: fixes from review (1be7dc01)
- Mobile header: the title's words grow with the text size only as far as the list clears (fd953cbb)
- Channel header: follow the reader's mute of the space from another device (beae3323)
- Channel bell: the space's mute from GetSpace, and a late mute answer gives way to an event (b1c828ca)
- Mobile: the server sheet's top corners are rounded on Android (65367327)
- Channel bell: only an event about the mute overrides a mute's own answer (ab75d318)
- Mobile: Android's tab bar has room above its icons and a rounded top (8fc1a6db)
- Mobile: switching server on Android slides the sheet out, then swaps (a1d2829a)
- Mobile: add LiveKit to the build (STOOPMOBIL-46) (a090d12a)
- Mobile: a voice room opens its Stage, with Join inert (STOOPMOBIL-49) (86f986a2)
- Mobile: the voice room reloads only for what it shows (8c4f702b)
- Mobile: a voice room's people stay in the order they joined (STOOPMOBIL-49) (9f31c5c4)
- Mobile: a finished session's voice roster is forgotten (831d6541)
- Mobile: an Android release build gets the R8 rule LiveKit needs (e5f43fd1)
- Mobile: a voice room's Join joins the call (STOOPMOBIL-48) (8476fa52)
- Mobile: a room switch stops when overtaken, and a failed join's close is waited for (fd534616)
- Mobile: a call's Speaker switches the loudspeaker and the earpiece (STOOPMOBIL-48) (71a464a3)
- Mobile: a voice room's Call | Chat switch, with the room's chat (STOOPMOBIL-50) (7bead4cd)
- Mobile: the server taking you out of a voice room ends the call (STOOPMOBIL-61) (4aefc533)
- Mobile: a call bar takes the server row's place on the tabs (STOOPMOBIL-51) (b24e5aa5)
- Mobile: the call bar names no speaker until this account is known (26e01bf6)
- Realtime: the gateway knows which session each socket belongs to (STOOPMOBIL-69) (a7a9bc47)
- Realtime: review fixes for the session count (STOOPMOBIL-69) (7400244c)
- Server: a Web Push sender package (STOOPMOBIL-68) (12705f1a)
- Push: a module that stores each session's Web Push subscription (STOOPMOBIL-70) (25b85f79)
- Web Push: no redirects, wall-clock token reuse, endpoint kept out of errors (2e0c500b)
- Realtime: a closed socket's session drops before presence cleanup (STOOPMOBIL-69) (2ce12c50)
- Push: a local server id is letters, digits, - and _; a bad kind names its index (8b71247b)
- Web Push: the audience is the serialized origin, and a failed post says fixed words (b190d47b)
- Mobile: the header's title pill is the bar's height on Android (ef46a563)
- Mobile: the call pill under a channel's, a conversation's and a thread's header (STOOPMOBIL-52) (be270f26)
- Mobile: the call pill follows the header's real height and goes back to a room already open (STOOPMOBIL-52) (de0caed9)
- Mobile: the call bar's wave moves, and the call pill fades out (STOOPMOBIL-52) (ea3d6970)
- Mobile: the call bar's wave moves only on the screen in front (STOOPMOBIL-52) (dd92cd8d)
- Mobile: a call says when it is reconnecting, and when it was lost (STOOPMOBIL-53) (a20a76f9)
- Mobile: rings after a reconnect, removal by LiveKit's own enum, a taller Open Settings (STOOPMOBIL-53) (d5655be3)
- Brand: rounded corners on the Windows icons and the web app's two PNGs (0c67ee1f)
- Mobile: Open Settings reads as a link that leaves the app (STOOPMOBIL-53) (ad200504)
- Mobile: the speaking ring goes around the whole tile, names sit lower left, a muted microphone is red (3c0a9707)
- Mobile: a tile's name stops growing before it reaches the avatar, and the README's call bar microphone is red (ae7e9b58)
- Mobile: the phone says where a call's sound goes, and when that changes (STOOPMOBIL-60) (2d68ae7a)
- Mobile: a change of outputs is read a second time, half a second on (STOOPMOBIL-60) (e17fe7a8)
- Mobile: a tile's name and muted microphone sit on a plate, as web's (4ed8a3c7)
- Mobile: one Output control shows where a call's sound goes, and moves it (STOOPMOBIL-60) (59f882ec)
- Mobile: review fixes for the Output control (STOOPMOBIL-60) (85fdc2c3)
- Mobile: an output Android didn't take is tried again at the next reading (STOOPMOBIL-60) (08814f7e)
- Mobile: iOS's picker has no earpiece, so the app's rules for a pick there go (STOOPMOBIL-60) (53501737)
- Mobile: a call the server hasn't placed says Establishing connection (ac14e2c8)
- Mobile: every call starts muted (dadb7a88)
- Mobile: the microphone is muted before it is published, as web's (22cdf809)
- Mobile: a join closed while its microphone mutes doesn't go on to connect (c5b38a84)
- Push keys for iOS: a native module, the app group and the push entitlement (33ec6d77)
- Push keys: a locked keychain has its own code, and the extension needs the group named too (a7ceafed)
- Push store: a value JSON cannot write is refused as invalid (d1050929)
- Mobile push: subscribe each session on iOS (STOOPMOBIL-73) (a45a9947)
- Push: send each activity item to the recipient's devices (STOOPMOBIL-71) (9fdcf5a8)
- Mobile push: review fixes to the subscription check (STOOPMOBIL-73) (0632554e)
- Push: fit over-long names too, say why a payload was refused (da409cf2)
- Mobile push: a token heard mid-pass replaces the pass's (STOOPMOBIL-73) (0c79cf3e)
- Push: ask again before each attempt; deliveries share one job budget (cc68d9fe)
- Mobile push: answer review on the subscription check (STOOPMOBIL-73) (5707a3bd)
- Push: each delivery kind keeps half the shared budget (5453d0cd)
- Jobs: capped kinds take turns, least recently leased first (1c5d653f)
- Mobile push: the service extension decrypts and writes the notification (STOOPMOBIL-74) (681baa44)
- Mobile push: opt-outs during backoff, delete after a racing check (STOOPMOBIL-73) (fca67211)
- Push: a retry rechecks the kinds the device still wants (520564eb)
- Push mirror: an update that changes nothing no longer stops later writes (1609e62b)
- Hand push: the script prints nothing read from the environment (82728eff)
- Push: a delivery job stores identifiers only (dd53787b)
- Alert prefs: a refused keychain read is not taken for the saved prefs (bd39569a)
- Push: a deactivated account's sessions are not live (c7044a5a)
- Extension plugin: a prebuild without --clean refreshes the target's settings (c141d242)
- Bump actions/setup-java from 6.2.0 to 6.3.0 in the actions group (41bd9c1d)
- Bump actions/setup-go from 7.0.0 to 7.1.0 (bbd5f305)
- Web: a banner click keeps the voice call (7712a7ec)
- System messages: storage, wire shape, recordEvent and the read path (STOOP-534) (db29092d)
- Docs: system messages in the architecture docs (STOOP-534) (dd1de8a8)
- System messages: review fixes (STOOP-534) (36ec9cd2)
- System messages: the guards (STOOP-535) (614a2488)
- System messages: review fixes to the guards (STOOP-535) (f4930143)
- System messages: channel changes, recorded and drawn on web (STOOP-536) (f320396e)
- System messages: review fixes (STOOP-536) (eae0aea1)
- System messages: the mobile row (STOOP-537) (1e94d15b)
- System messages: mobile row review fixes (STOOP-537) (321d8a97)
- System messages: read past a page of quiet rows (STOOP-537) (18f3d6e9)
- System messages: mark read only within the rows held (STOOP-537) (b4019fc9)
- System messages: who joins and leaves a private channel (STOOP-538) (ccfd273f)
- System messages: record leaving the space (STOOP-540) (00eca0bc)
- System messages: pin rows (STOOP-539) (a720ea0e)
- System messages: space departure review fixes (STOOP-540) (7f1ea5fc)
- System messages: pin rows review fixes (STOOP-539) (9320409e)
- System messages: hold the membership before listing channels (STOOP-540) (1f150f6b)
- System messages: membership review fixes (STOOP-538) (0ea2d5c6)
- System messages: pin spec opens at the newest message (STOOP-539) (28a545da)
- System messages: departure lock review fixes (STOOP-540) (b500a2ac)
- System messages: hold the channel FOR NO KEY UPDATE on membership (STOOP-538) (ae21554a)
- System messages: group save adds before it removes (STOOP-540) (73850e1d)
- Remove pin rows with their message (STOOP-539) (5c79dbf0)
- Pin rows: tell a gone message by its author (STOOP-539) (24d023d5)

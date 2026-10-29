Stoop 0.18.0

Stoop 0.18.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.17.0, and `stoop upgrade rollback`
takes it back: it ships no migration, and the schema does not change.

**What's in it.**

- **The voice bar, redrawn.** The sidebar's voice bar is now a status
  row with Disconnect beside it, a device list, and the call's toggles
  as a row of equal tiles. The microphone and camera rows are always
  there, so the bar no longer changes height when a camera comes on:
  one microphone is named without a chevron, and the camera row reads
  "Camera off" until the camera is on, then names it. A row with a
  choice is still the browser's own device menu underneath.
- **Your mic's level, and a word when it is quiet.** Ten small segments
  in the microphone row light as you talk, with the highest recent
  level holding for a moment. They read the sound as it is sent, after
  the browser's gain control, so they show what the others hear. Talk
  for a few seconds at a level that never lights your speaking ring and
  the segments and the mic glyph turn amber, with the hint "Your mic is
  quiet. Move closer or turn it up in your system settings." on hover.
  Silence is not quiet: an open mic nobody talks into stays green.
- **Volume to 300%, without the crackle.** The slider's ceiling rises
  from 200% to 300%, and its marks are now words: Off, Normal and
  Loudest. Every remote voice plays through a limiter after the
  slider, so a shout at 300% stays clean. At Normal the call sounds
  exactly as it did; the limiter does nothing until a peak is within a
  decibel of full scale.
- **Even out voices.** A switch in the volume panel, under the marks,
  puts a compressor on each speaker's voice, so a quiet talker comes up
  and a loud one comes down a little. Off by default and kept in the
  browser, like the volume; Reset leaves it alone. The line under it,
  "Louder volumes may distort sound.", is the honest caveat: it lifts
  ordinary speech, and at 300% that lift lands on the limiter.
- **The stage's controls read in every theme.** The pill of controls
  over the video stage and the name plates on tiles use fixed on-video
  colours now, light on near-black whatever the theme. In a light theme
  they were dark glyphs on a dark wash.
- **Activity is an inbox.** New holds unread items as cards, newest
  first, with Mark all read on its heading; Read holds the rest as flat
  rows with the day inside the first row of its day. Each row says what
  it is with a glyph on the avatar's corner (@ for a mention, a reply
  arrow, a thread bubble, an envelope for a direct message), names the
  person, the verb and the channel, and shows the message with your
  handle, @channel and @here highlighted. Older pages load as you reach
  the end.
- **Reading a channel reads its mentions.** Once your read marker moves
  past a message, the mentions and replies that pointed at it count as
  seen, in the channel and in its threads, and the badges go with them.
  Before, only the Activity page cleared them, and only its first page,
  so an older mention could keep a badge lit for good. Sending a message
  moves your own marker, so it clears too.
- **The phone app**, still unreleased, had one fix: opening a channel
  clears its mention badges. None of it ships in this image, nor does
  the development seed's new pixel-art avatars.

**For operators.**

- **Nothing to do.** No migration runs; the schema stays at 72 and the
  floor at 70. `stoop upgrade rollback` returns to 0.17.0.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.
- **Personal tokens** without the `activity.read` grant move a read
  marker but leave the account's badges alone, the same gate the
  Activity page's own clearing has always had. A script that posts as
  you will not read your mentions for you.

**API changes.** No new or changed messages. Three calls do more than
they did: `MarkChannelRead`, `MarkThreadRead` and `SendMessage` now mark
the activity their marker passes as read, in the same transaction, when
the credential carries `activity.read`. A client that cleared activity
by hand after moving a marker can stop.

**Schema.** Unchanged: 72, with the floor at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.17.0.

**Known issues.** As 0.17.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load. New with the
read-marker change: older pages of the Activity page do not refresh
when items are read elsewhere, and in a narrow race an activity item
coalesced just as it is read can come back unread.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.17.0:

- Mobile: reading a channel reads its mentions (53cd846f)
- Activity: the inbox split (62a686ea)
- Activity: two-line rows, and the read section is Read (4a6989a2)
- Activity: a rule between read rows, the day inside the first of them (368926d0)
- Activity: a little more air in each row (38a4a1d1)
- Activity: the unread glyph wears the badge red (608d1e1b)
- Activity: the preview at body size (eca6e364)
- Activity: read rows keep their preview bright (7a558d98)
- Dev seed: every account gets a pixel-art avatar (5c6fb2a5)
- Proposal: the voice bar, the mic level, and evening out voices (6773e803)
- Voice volume: 300%, through a gain node and limiter of our own (38e09809)
- Voice bar: a status row, a device list and toggle tiles (b1e2c09d)
- Voice chain: unity at 100%, no leak on rewire, the chip when suspended (985bdc24)
- Voice bar: plain rows where there is nothing to pick, and review fixes (169aa964)
- Voice bar docs: only a row with a choice is a select (b7bea6d6)
- Voice chain: relink a microtask after LiveKit's own rewire (5265df1d)
- Voice bar: your mic's level in the mic row, and a quiet state (764a1eab)
- Even out voices: a compressor per speaker behind a switch in the popover (7942933d)
- Even out voices: the make-up figures as the engines compute them (dc1bf181)
- Mic level: a run that ends, a kit slot that makes room, review fixes (50e2eed4)
- Mic level: amber stays long enough to read, and counts what is lit (d39b53ae)
- Mobile: read a mention that arrives while its channel is open (d5af04ac)
- Reading a channel or thread reads the activity its marker passes (22431c24)
- Voice bar: tiles share the width evenly, Disconnect the size of a tile (87c23d64)
- Voice bar docs: Disconnect is a tile the height of theirs (de1fdde2)
- Voice bar: the mic row's glyph is crossed while muted (7bc66af2)
- Voice bar: format the mic row glyph line (9da8aa3d)
- Read-clears-activity: review fixes (63c2b790)
- Read markers take the channel row first (01b4e19d)
- ShareChannel joins the queries excused from the reader view (6c793799)
- Voice stage: the chrome over video uses a fixed on-video palette (516808cf)
- Voice stage: round the pill's end buttons, say where the on-video palette lives (84df8f6e)
- Voice volume: the popover keeps the theme's text on the stage (59752a10)

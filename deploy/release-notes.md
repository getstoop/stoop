Stoop 0.24.0

Stoop 0.24.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.23.0 and has no migration, so
`stoop upgrade rollback` takes it back with nothing to undo. One thing
is lost on the way back, under "For operators": a time poll closed while
0.23.0 runs loses its times.

**The licence has changed.** From this release Stoop is source-available
under the Functional Source License (FSL-1.1-ALv2), with getstoop LLC as
licensor, where 0.23.0 and earlier were Apache-2.0. You can run it,
change it and share it for any purpose except offering it to others in a
commercial product or service that competes with Stoop, or with a
service the project runs on it. The reason is to keep Stoop from being
repackaged and sold. Each release becomes Apache-2.0 two years after it
is published. The protocol definitions in `proto/` are Apache-2.0
today, so anyone can build a client. Stoop 0.23.0 and earlier stay
Apache-2.0. Contributions are licensed to getstoop LLC under
Apache-2.0; `CONTRIBUTING.md` says how.

**What's in it.**

- **Find a time.** A poll whose options are times. On web the composer
  has a Find a time button beside the poll button; on mobile it is a
  row in the attach sheet; `/when` opens it on both, with anything
  typed after it as the question. It takes a question and 2 to 10
  times, each on a whole minute, in the future and at most a year
  ahead, no two the same. People pick several times unless the asker
  chooses one. Everything else is a poll's: who can vote, named votes,
  changing a vote, closing, pinning, deleting, and who it tells.
- **Times in each reader's zone.** A time is stored as an instant and
  nothing about a zone is kept. Each person sees every time in their
  own device's zone, with its weekday and date (and the year when it is
  not this year), earliest first, and a line on the card names that
  zone. The line gives the offset when all the
  poll's times share one ("New York (GMT−5)") and the name alone when
  they fall on both sides of a clock change.
- **A time that has passed** stays on the card, marked "Passed", and
  still takes votes. The mark appears the next time the card is drawn,
  not on the minute.
- **Closing a time poll** names the winning time in the closing line,
  worded in each reader's zone, or each tied time when several tie.
- **A date and time picker on web.** Stoop now draws its own, in place
  of the browser's, so it follows the theme: a month grid and a list of
  times in half-hour steps, with any minute typed by hand. The reminder
  form's "Pick a date and time" uses it, and so does each time in Find
  a time. On mobile both forms use the system's pickers, as before.

**For operators.**

- **No migration.** The schema stays at 79 and the floor at 70. A time
  poll is a poll row whose options carry a time, so nothing in the
  database changes shape and the upgrade takes no longer than usual.
- **Rolling back to 0.23.0** needs nothing undone, but 0.23.0 does not
  know a time option. It shows a time poll's options with no words, and
  if a time poll is closed while 0.23.0 runs, the poll is written back
  without its times: they are gone for good, and returning to 0.24.0
  does not bring them back. The closing line it posts names no winner,
  then or later. Votes are kept. Time polls that are not
  closed while 0.23.0 runs come back whole with 0.24.0. If you roll
  back, close no time poll until you are on 0.24.0 again.
- **The server's clock decides whether a time is ahead.** The app turns
  the time picked into an instant and the server checks only that it is
  after now and within a year. Unlike a reminder, the device works out
  the instant, so a device whose clock or zone is wrong offers the
  wrong time.
- **Nothing new runs.** No new job, setting or table. A time passing
  does nothing on the server.
- **Outgoing webhooks** never deliver a time poll, its votes or its
  closing line, as with every poll.
- **Bots and personal tokens that read history** receive a time poll
  where they receive a poll, its options carrying `at` and empty text.
  A token that may post may create one.
- **Notification and preview text** for a time poll carries its
  question and no times: the server words it and does not know the
  reader's zone. Search finds a time poll by its question only.
- **The mobile app** built from this release needs a server of 0.24.0
  or newer and refuses to add an older one. An app already on a server
  that is then rolled back keeps working, but Find a time is refused
  there.
- **No dependency moves** in the server, the web app or the mobile app.
  The web picker is Stoop's own code.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `CreatePollRequest` gains `times` (field 5), a list of timestamps
  sent in place of `options`; a request with both is refused. The
  server takes 2 to 10, rounds each down to the whole minute, requires
  each to be after now by its own clock and at most one calendar year
  ahead, refuses two on the same minute, and stores them earliest first
  whatever order they came in. Every refusal is `InvalidArgument`.
- `PollOption` gains `at` (field 4): set on a time option, where `text`
  is empty, and unset on a text option. A poll is all text or all
  times, and a client tells a time poll by `at` being set.
- `PollWinner` gains `at` (field 3), set when the winner is a time.
- Nothing else moves: a time poll is voted on with `SetPollVote`,
  closed with `ClosePoll`, deleted with `DeleteMessage` and pinned with
  `SetMessagePinned`, and reaches clients in the same events as a poll.
  A client that does not know `at` shows a time poll's options blank.

**Schema.** 79, unchanged; the floor stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.23.0.

**Known issues.** As 0.23.0's: deleting a message above the part of a
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
tab is reloaded; when the retention sweep removes a pinned message, an
open tab keeps showing its pin line's excerpt until it is reloaded;
taking someone out of a space can fail with an error when it collides
with another change to the same channels at the same moment (trying
again works), and a ban that fails this way leaves the person banned
but still a member until the ban is made again; the times the reminder
form shows beside its choices come from the device's clock, so on a
device whose clock is wrong they differ from the time the server sets,
which the notice then shows; a reminder that is dropped at its time
tells nobody, the person who set it included; a reminder left waiting
by someone who has gone still counts toward their 50 until its time
passes. New: on mobile, if the device's time zone changes while the app
is open, Find a time can post a time on the wrong day and name the zone
with the wrong offset until the app is restarted (seen on Android; a
picked reminder time may be affected the same way); on web, a time
typed inside the hour a clock change skips is moved an hour later
without a message; on mobile, the last line of the Find a time form's
zone note stays dimmed at the end of its scroll.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.23.0:

- Relicense to the Functional Source License (FSL-1.1-ALv2) (8ca84a33)
- Licensor is getstoop LLC, one word (b8b06f8c)
- Web: DateTimeField, and the reminder form moved onto it (STOOP-557) (96c6d4b5)
- Docs: DateTimeField in the design system and the reminder form (352b9164)
- DateTimeField: review fixes (STOOP-557) (2f9bc5df)
- DateTimeField: close paths settle once; step from the typed time (STOOP-557) (1c12d290)
- DateTimeField: a press that is not a click leaves the panel working (STOOP-557) (0b51c422)
- Time polls on the server: poll options that carry an instant (6702e289)
- DateTimeField: review round (STOOP-557) (12df04d3)
- DateTimeField: labels independent of the device's zone (STOOP-557) (5f414d90)
- Find a time: shared rules, /when and the closing line (STOOP-559) (72bc9855)
- Find a time on web: the form, the card and a browser spec (STOOP-559) (7cd13486)
- Find a time: zone labels for fixed zones, tests that can fail (STOOP-559) (ed45e010)
- Find a time: a key in an open panel never posts a stale time (STOOP-559) (6aaabf52)
- Find a time spec: point at the visible error line (STOOP-559) (be3177d2)
- Find a time on mobile: the form, the plus-sheet row and /when, the card (STOOP-560) (51511f0d)
- zoneLabel: work the offset out, never read it from a zone name (STOOP-560) (a4d302ed)
- Find a time on mobile: an open picker stays put, a half-picked row says so (STOOP-560) (279ccb8b)
- Find a time on mobile: a test of the time poll request, import order (STOOP-560) (9c51791f)
- DateTimeField: a click outside the dialog closes an open panel only (STOOP-561) (a1210ab2)
- DateTimeField: hold back only the scrim's click, and give focus back to the field (STOOP-561) (a3dc32e9)
- Find a time: the zone line's offset is the poll's times' own (STOOP-562) (5ad061d1)
- Find a time: the zone line is never blank; a spec that straddles a clock change (STOOP-562) (6fddb919)

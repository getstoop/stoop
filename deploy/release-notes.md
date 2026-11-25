Stoop 0.23.0

Stoop 0.23.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.22.0, and `stoop upgrade rollback`
takes it back: its two migrations only add, so 0.22.0 starts against the
result. What 0.22.0 makes of the new rows is under "For operators".

**What's in it.**

- **Polls.** The composer has a poll button: a question, 2 to 10
  options, and whether people pick one option or several. The poll sits
  in the timeline as a card. Anyone who can react there can vote, votes
  carry names, results show before you vote, and a vote can be changed
  or taken back while the poll is open. Polls work in channels, direct
  messages and group conversations.
- **Closing a poll.** Whoever asked can close it, and so can an admin
  or the owner in a space. Closing is final: nothing reopens a poll and
  there is no deadline. It adds a line to the timeline naming the
  winning option or options, with a link back to the poll.
- **What a poll takes.** It can be pinned in a space channel by whoever
  can pin there, and deleted by whoever asked or by an admin or the
  owner; deleting it removes its votes, its pin and its closing line.
  It takes no reactions, replies, thread or edits. Search finds a poll
  by its question, not by its options.
- **Who a poll tells.** In a channel a poll and its closing line mark
  the channel unread and alert nobody. In a direct message or group
  conversation both alert the others as a message does. A vote marks
  nothing unread and alerts nobody. An `@name` in a question is plain text and mentions
  no one.
- **Slash commands.** Typing `/` at the start of a message lists the
  commands, filtered as you type; Enter, Tab or a click picks one.
  There are two. `/poll` opens the poll form, with anything typed after
  it as the question. `/remind` opens the reminder form, with anything
  typed after it as the text. Commands are read by the app and never
  sent: a `/word` that is not a command goes out as ordinary text.
  They are not offered in a thread or while editing a message.
- **Reminders.** A reminder is one line of text, up to 200 characters,
  that Stoop posts at a time you choose in the channel or conversation
  you set it in, under your name and marked with a bell. The form
  offers in 20 minutes, in 1 hour, in 3 hours, tomorrow at 9:00, or a
  date and time up to a year ahead. Until its time nobody else sees it.
  A short notice confirms it with an Undo; after that there is no list
  of waiting reminders and no way to take one back. Each person can
  have 50 waiting.
- **When a reminder arrives.** It is never early, and normally lands
  within about half a minute of its minute. In a channel it marks the
  channel unread and alerts nobody. In a conversation it alerts the
  others. The person who set it gets an unread mark and no alert. A
  reminder is dropped silently if, at its time, its person could no
  longer post there: they left or were removed, the channel became
  announcement-only, a block stands in the conversation, or the account
  is gone. Whoever set it can delete it once posted, and so can an
  admin or the owner in a space.

**For operators.**

- **Expand migrations.** 00078 adds the `poll_votes` table and appends
  one column (`reference_kind`) to the `message_with_reply` view. 00079
  adds the `reminders` table with two indexes. Neither reads or
  rewrites existing rows, so the upgrade takes no longer than usual.
  The floor stays at 70.
- **Rolling back to 0.22.0** needs nothing undone, but 0.22.0 does not
  know the three new kinds of row. A poll, a closing line and a posted
  reminder each show as a line asking the reader to update, and still
  count as unread. Votes stay in the database and come back with
  0.23.0. Reminders still waiting are not posted while 0.22.0 runs: it
  switches the delivery schedule off when it first falls due, 0.23.0
  switches it back on at start, and anything that came due meanwhile
  is posted late.
- **A new scheduled job, `deliver_reminders`, runs every 30 seconds.**
  It is the first scheduled job people wait on; the other seven only
  tidy. On a fresh install its first run is two minutes after the
  server first starts. With `STOOP_JOBS=external` and no `stoop jobs`
  running, reminders wait and are posted once one runs. If the process
  running jobs is killed in the middle of a run, delivery waits for
  that run's lease to lapse, 10 minutes by default. A run that could
  not post a reminder keeps it for the next run and ends as failed
  with a count, which shows on the Diagnostics tab.
- **More rows in `jobs`.** Each run leaves one: 2,880 a day, about
  20,000 held at the default `STOOP_JOBS_RETENTION` of a week, where
  the other scheduled jobs leave about 600 a week together. With
  `STOOP_JOBS_RETENTION=0` they are all kept, about a million rows a
  year.
- **The server's clock decides when a reminder is due.** A client says
  what time is meant and the server works out the instant, so a device
  with a wrong clock still sets the right reminder, and a server with a
  wrong clock posts at the wrong time. The time zone database is now
  built into the binary (about half a megabyte), so a host without one
  still knows every zone.
- **Outgoing webhooks never deliver a poll, a vote, a close, a closing
  line or a reminder.** Deleting a poll sends a `message.deleted` for
  the poll and then one for each of its pin lines and its closing
  line, none of which the hook was sent. A receiver should ignore a
  delete for an id it does not hold, as before.
- **Bots and personal tokens that read history** receive the new rows
  in their places with `event` set. Unlike the earlier kinds these
  carry text in `content`: a poll's question, and a reminder's text. A
  token that may post may also create, vote on and close polls and set
  and take back reminders, under the rules a person's own call meets.
- **No dependency moves** in the server or the web app.
  `golang.org/x/text` is now used directly, at the version already in
  the build.
- **The desktop app** is not told to update by this release. The bridge
  level the server publishes is unchanged.

**API changes.**

- `SystemEvent` gains three cases: `poll` (question, options with
  their voters, whether several may be chosen, the count of distinct
  voters, and who closed it and when), `poll_closed` (the question,
  the winning options with their counts, and how many voted;
  `reference` is the poll) and `reminder` (empty; the text is
  `Message.content` and the person `Message.author`). None of the three
  is `quiet`. A client that does not know a case asks the reader to
  update, as before.
- New on `ChatService`: `CreatePoll`, gated as `SendMessage` is;
  `SetPollVote`, gated as `ToggleReaction` is, which takes the caller's
  whole selection and takes the vote back when it is empty; `ClosePoll`,
  for the poll's author or `messages.moderate` in a space.
- New on `ChatService`: `CreateReminder` and `DeleteReminder`.
  `CreateReminder` takes the text and exactly one of `preset`
  (`IN_20_MINUTES`, `IN_1_HOUR`, `IN_3_HOURS`, `TOMORROW_AT_9`) or
  `local_time` (`YYYY-MM-DDTHH:MM`, no offset), with `time_zone` as an
  IANA name, required for `TOMORROW_AT_9` and `local_time`. It never
  takes an instant. It answers with the reminder's id and `remind_at`,
  the instant as stored, rounded down to the minute. With 50 already
  waiting it answers `ResourceExhausted`. `DeleteReminder` removes a
  waiting reminder of the caller's own; anything else is `NotFound`.
- A vote or a close reaches clients as `message_updated` carrying the
  whole poll. A close is followed by `message_created` for its closing
  line. Deleting a poll sends `message_deleted` for the poll and then
  for each line about it.
- A poll is deleted through `DeleteMessage`, by its author or with
  `messages.moderate`, and pinned through `SetMessagePinned`. A poll
  and a reminder refuse edits, reactions, replies, quotes, threads and
  link preview dismissal with `FailedPrecondition`, as every row with
  `event` set does; a reminder and a closing line also refuse a pin.

**Schema.** 79, from 77; the floor stays at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.22.0.

**Known issues.** As 0.22.0's: deleting a message above the part of a
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
but still a member until the ban is made again. New: the times the
reminder form shows beside its choices come from the device's clock,
so on a device whose clock is wrong they differ from the time the
server sets, which the notice then shows; a reminder that is dropped
at its time tells nobody, the person who set it included; a reminder
left waiting by someone who has gone still counts toward their 50
until its time passes.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.22.0:

- STOOP-544 Polls: server foundation (68aae0fe)
- STOOP-544 Document polls in the architecture docs (1d27df56)
- STOOP-544 Polls: bound and tighten poll validation (fe54b810)
- STOOP-545 Polls: vote, close and delete (d6ab5a71)
- STOOP-545 Document voting on, closing and deleting a poll (b4ac43f1)
- STOOP-545 Polls: publish a vote and a close at their own seqs (5e40ab66)
- STOOP-546 Polls: the web card, its actions and the closing row (baef0dc5)
- STOOP-546 Document the web poll card (9de44e19)
- STOOP-546 Polls: review fixes to the web card (728e38f4)
- STOOP-546 Polls: give up a vote unanswered in 15 seconds; split the poll stylesheet (51479404)
- STOOP-547 Polls: the create form's rules, shared with mobile (f68d9d6e)
- STOOP-548 Polls: the mobile card, its votes and its menu (d3a8b154)
- STOOP-548 Polls: create a poll on mobile (c49cedae)
- STOOP-547 Polls: the create form's rules, shared with mobile (f080c466)
- STOOP-547 Polls: create one from the web composer (d21a3f28)
- STOOP-547 Specs: press Create exactly (1ea3200f)
- STOOP-548 Polls: a poll row and a system row are separate kinds (1745276f)
- STOOP-548 Document polls on mobile (d1675f46)
- STOOP-547 Polls: review fixes to the create form (917ac9d9)
- STOOP-548 Polls: the mobile form keeps a refusal's words and its own (dceb7c0a)
- STOOP-547 Polls: the form stays usable under StrictMode; Cmd+Enter from its actions (834fcb23)
- STOOP-548 Polls: the mobile card at large text sizes (7e6f4b15)
- STOOP-548 Polls: a solid option edge after a vote on Android (da25bd98)
- STOOP-548 Polls: review fixes to the mobile card, form and menu (d952c2bb)
- STOOP-548 Polls: moving result bars; room above Post poll (9e731a5e)
- STOOP-548 Polls: the form's fields fade out above Post poll (7ce04bb8)
- STOOP-551 Slash commands: the command list and /poll on web (a5b9a387)
- STOOP-551 Slash commands: review fixes for the list and /poll (374bffe0)
- STOOP-551 Slash commands: the poll button gets focus back on cancel (27ae1363)
- STOOP-551 Slash commands: platform-independent arrow check in the spec (5f9ff010)
- STOOP-553 Reminders on the server: table, kind 9, RPCs, delivery job (6c9011d5)
- STOOP-553 Reminders: a jobs process knows whether voice is configured (05efbce0)
- STOOP-553 Reminders: a delivered reminder is not the reader's own send (8e663c84)
- STOOP-553 Reminders: say how late one can be, and what the job leaves (2be38cd5)
- STOOP-553 Reminders: the server works out the instant, not the client (c0885499)
- STOOP-552 Slash commands: the command list and /poll on mobile (4cac22d1)
- STOOP-552 Slash commands: the form opens once the keyboard has gone (c462e14f)
- STOOP-552 Slash commands: a command's form waits only while nothing else opens (fda96e2d)
- STOOP-554 Reminders: the shared rules, /remind, and future times (2a4cbf95)
- STOOP-554 Reminders on web: the form, the notice with Undo, the row (c224a6ee)
- STOOP-554 Reminders on web: browser spec and docs (45a20f5c)
- STOOP-554 Reminders on web: review fixes for the notice and late answers (e95f9fee)
- STOOP-554 Slash commands: an app lists only the commands it can open (58fb22f0)
- STOOP-554 Reminders on web: the server's clock decides the time (a8df3568)
- STOOP-554 Reminders on web: second review fixes (2c401cb7)
- STOOP-552 Slash commands: a command is dropped while the viewer is open (d0d43982)
- STOOP-553 Reminders: the request test's date no longer depends on today (f20a532f)
- STOOP-554 Slash commands: mobile opens /poll only (e24c4ed6)
- STOOP-554 Reminders on web: an older Undo answer leaves a newer notice alone (03b6d8db)
- STOOP-555 Reminders on mobile: /remind, the form, the notice, the row (f1b8837c)
- STOOP-555 Reminders on mobile: docs (570e738d)
- STOOP-555 Reminders on mobile: review fixes (eb3cd041)
- STOOP-555 Reminders on mobile: late answers seen, one Undo per notice (9b28566b)

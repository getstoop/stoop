Stoop 0.17.0

Stoop 0.17.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.16.0, and `stoop upgrade rollback`
takes it back: it ships no migration, and neither the schema nor the API
changes.

**What's in it.**

- **Voice volume.** A speaker button beside Deafen on the call's
  controls, on the sidebar's bar and over the stage alike, opens a
  slider from 0 to 200%: one knob for the whole call, kept in the
  browser. Past 100% is a boost for a call a game is drowning out. The
  call is now mixed through Web Audio with a gain per voice, which an
  audio element's own volume could not do; Deafen is that gain at zero,
  so it sounds as it did. Ctrl+Shift+Up and Ctrl+Shift+Down step the
  volume by 10 while you are in a call, with a switch of their own on
  Account → Voice, in a browser only, as push to talk is. The desktop
  app will hold the keys from any app in its next release.
- **One set of Markdown cases** now checks the server and the web app
  against each other, so the two cannot drift in what they accept.
  Tests only; nothing a user sees changes.
- **The phone app**, still unreleased, took most of the work merged
  since 0.16.0: a composer with Markdown and mentions, the channel
  header, search, opening at a message, pins. It is built against the
  server as it is, and none of it ships in this image.

**For operators.**

- **Nothing to do.** No migration runs; the schema stays at 72 and the
  floor at 70. `stoop upgrade rollback` returns to 0.16.0.
- **The desktop app** is not told to update by this release. The web
  app lists two new voice actions for it under bridge 6 but keeps
  publishing bridge 5 from `GET /version` until a desktop release that
  implements them has shipped, as the contract requires.

**API changes.** None.

**Schema.** Unchanged: 72, with the floor at 70.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.16.0.

**Known issues.** As 0.16.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.16.0:

- Phone mentions: the proposal (5c84a707)
- Phone mentions: handles typed in full go as mentions (6ac02def)
- Phone mentions: the list, picks and the @ button (5a19f5db)
- Phone rich editor: the proposal (d2f5c063)
- Markdown: one set of cases for the client and the server (a55b82a0)
- Rich editor: Markdown in core, and the document as lines (58fd85f1)
- Rich editor: what the phone's composer reads from core (dc0389ba)
- Rich editor: the plain field's core stays until the composer swaps (6eee51ef)
- Phone composer: the field in the card, and its flows (4fe12488)
- Rich editor: the import line as the formatter has it (6b5750d3)
- Phone composer: the field, on iOS (894f3fcb)
- Phone composer: the field, on Android (eda2a843)
- Phone composer: the plain field's core goes (8a298490)
- Phone composer: a run of the checks against main (9b5ce5ae)
- Docs: drop the built rich editor proposal; the phone's field in messaging.md (33277be2)
- Phone channel header: the title in a pill floating over the list (304c639d)
- Phone channel header: lines at the left, the # tall beside them (4fe8461e)
- Phone channel header: the list fades out under the status bar (009a152a)
- Docs: drop the built phone Markdown and mention proposals (a6857275)
- Phone channel: the list fades out under the home indicator too (b7b835c5)
- Phone channel: a button back to the latest message (757f06d7)
- Phone channel: scrolling leaves the keyboard up (83a8f590)
- Phone: search a space's messages from the channel header (f593230f)
- Phone search: one tree under the header, and the review's fixes (44a8e451)
- Phone channel: open at a message, page newer, jump back to the newest (b31624e6)
- Phone channel: no newer page while landing, retry a scroll by row (6c1c79f5)
- Phone channel: pin and unpin from the menu, with a Pinned mark (15b7a180)
- Phone search: the review's second round (b81b8183)
- Phone channel: the Pinned mark keeps web's gap under it in a continued row (84710295)
- Phone search: quote-aware filters, and no page loop after an error (26697860)
- Voice volume: a slider in the call, up to 200%, and keys to step it (d468004b)
- Voice volume: the stage bar's pill no longer clips the panel; keys in a browser only (a268c30c)
- Voice volume: the slider is a slider, not a field (081d87c5)

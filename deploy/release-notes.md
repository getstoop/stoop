Stoop 0.16.0

Stoop 0.16.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.15.0. **It is a contract release:
`stoop upgrade rollback` cannot take it back to 0.15.0.** Migration
00070 drops a column that 0.15.0 still reads, so 0.15.0 refuses to start
against the result. `stoop upgrade` says so before it starts, and the way
back is the backup it takes. Check 0.15.0 is working before you upgrade.

**What's in it.**

- **Image thumbnails.** A large image attachment (a PNG, JPEG or still
  WebP over 1024 px on a side, within size limits) gets a smaller copy, made in the
  background after upload. The web app draws images inline from it, so
  a channel full of phone photos loads a fraction of the bytes. The
  preview and downloads still use the original. GIFs, animated WebPs
  and animated PNGs keep their originals so they still move.
- **Image sizes at upload.** The server reads each image's width and
  height from its header, turned by the photo's EXIF orientation, so
  clients can lay a picture out before it loads.
- **Upright avatars and link preview images.** A phone photo stored
  sideways with a "rotate me" tag became a sideways avatar, space icon
  or link preview image. They are now turned the right way up, as
  thumbnails are. Images uploaded before this release keep how they
  were stored.
- **A memory bound on every image the server decodes.** A link preview
  image (fetched from any link a member posts) and an avatar or icon
  were bounded only by pixel count. A crafted 16 MP progressive JPEG
  could make one decode hold 240–380 MiB (the top end for CMYK), and
  up to four previews decoded at once beside the background jobs,
  enough to push a server past a 512 MB limit. Every still-image
  decode now reckons its memory from the header first and refuses
  anything over 288 MiB, and they run one at a time in each process.
  In practice this refuses only unusual images, such as progressive
  JPEGs over about 15 MP (12 MP RGB, 10 MP CMYK): as an avatar or
  icon, which the upload says plainly, or as a link preview, which
  keeps its card without the image (or has none, if the page had only
  an image). A preview whose image waits behind a large decode for
  longer than its fetch allows also loses the image; the next message
  with that link fetches it again.
- **The phone app**, still unreleased, took most of the work merged
  since 0.15.0 (the channel screen, threads, Markdown, attachments).
  It is built against these server features but none of it ships in
  this image.

**For operators.**

- **Contract migration.** 00070 drops `channels.swept_seq` and raises
  the schema floor from 68 to 70. Nothing has written the column since
  0.15.0, but 0.15.0's queries still name it when they read a channel,
  so 0.15.0 would fail on its first channel query; the floor makes it
  refuse to start instead. If an upgrade fails after 00070 has run,
  `stoop upgrade` prints the restore commands for the backup it took
  rather than offering `rollback` (if it fails before, it still offers
  `rollback`) ([Restoring in place](https://github.com/getstoop/stoop/blob/v0.16.0/docs/self-hosting/backups.md#restoring-in-place));
  anything written after the upgrade is lost by restoring it.
- **Upgrading from 0.14.0** straight to 0.16.0 runs 00069 through
  00072 in order and lands in the same place, with no rollback to
  either.
- **Checking the release.** The post-publish check in
  `docs/releasing.md` rolls back with `stoop upgrade rollback`; for this
  release, skip that step.
- **A new background job,** `thumbnail_attachment`, runs one at a time
  wherever your jobs run (`STOOP_JOBS`). Its measured peak is about
  300 MiB at most (293 MiB for a 75 MP JPEG, the largest it accepts;
  147 MiB for a typical 48 MP phone photo)
  ([files.md](https://github.com/getstoop/stoop/blob/v0.16.0/docs/architecture/files.md#thumbnails)).
  With jobs embedded in the server (the default), the server's own
  memory shares whatever limit you give it, so leave headroom above
  that. The bundled compose file's separate `jobs` container (the
  `jobs` profile with `STOOP_JOBS=external`) is limited to 512m with
  `GOMEMLIMIT=400MiB`, which covers it.
- **Existing attachments** get no size or thumbnail. Only uploads after
  the upgrade do, and clients fall back as before for the rest.
- **Storage.** A thumbnail is a file of its own (kind
  `attachment_thumbnail`), deleted with its original by every path that
  removes one: message deletion, retention and the sweep. It is made
  without a quota check, since its upload passed one, but it counts in
  storage usage, so usage grows a little with each large image.

**API changes.** Additive. `Attachment` gains `width` and `height`
(fields 6 and 7, 0 when unknown) and `thumbnail_file_id` (field 8, ""
when there is none). A thumbnail is served from `GET /files/{id}` under
its original's authorization.

**Schema.** Migrations 00070 to 00072 take the schema from 69 to 72 and
the floor from 68 to 70. 00070 drops `channels.swept_seq`. 00071 adds
`files.width` and `files.height`. 00072 adds `files.thumbnail_of`
(references `files`, `ON DELETE CASCADE`) with a partial unique index.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.15.0.

**Known issues.** As 0.15.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.15.0:

- Bump storybook from 10.6.0 to 10.6.2 in /web (5e403da7)
- E2E: Home is pressed until the picker closes (ac1425a7)
- Chat: channels.swept_seq is dropped (e67e150a)
- Chat: review follow-ups for the swept_seq drop (180707cb)
- Chat: longer names in the swept_seq drop test (6cf89e4c)
- Mobile: the channel screen runs on the channel log (33e96d70)
- Mobile: review follow-ups for the channel screen's log (127ca9af)
- Docs: step 9's pull request number in the proposal (cc6e688e)
- Mobile: the channel log's requests answer to a lifetime (9583a360)
- Core: the channel screen's reducer takes a send's answer (246767f7)
- Mobile: the channel's composer sends plain text (d3fc4a8b)
- Mobile: composer review follow-ups (e05904a7)
- Mobile: the message menu opens on a long press (cd334425)
- Mobile: the message-menu flow lets the list settle before a long press (e678fc57)
- Mobile: message menu review follow-ups (7b728536)
- Core: the reader's own reaction and delete on the channel screen (ece4d567)
- Mobile: quick reactions, Copy text and Delete message work (06adb0e8)
- Mobile: message actions review follow-ups (8952a502)
- Core: the emoji set, its search and the share-link paths, shared with the phone (17d5e1b6)
- Mobile: More reactions opens the emoji picker, Copy link copies the link (9fdf6028)
- Mobile: emoji picker and Copy link review follow-ups (30455809)
- Mobile: Quote in reply replies with a quote (c03dc000)
- Mobile: Quote in reply review follow-ups (e3dcb73c)
- Mobile: Edit message edits a message in the composer (c6f12a04)
- Mobile: Edit message review follow-ups (582efeed)
- Mobile: read threads (32d4e597)
- Mobile threads: review follow-ups (edd9252f)
- Mobile: write in threads (bf81ba12)
- Mobile threads: write review follow-ups (749f972e)
- Mobile: name layout anchors with unstable_settings.anchor (4cde7755)
- Mobile: mute a thread from its header (8c1d5649)
- Mobile thread mute: review follow-ups (0021c257)
- Mobile thread mute: the bell as a native bar button on iOS (4d7041c4)
- Mobile threads: wait on a running catch-up, refetch a pruned root (175f4c3c)
- Core: share the attachment limits and upload queue with the phone (bc80a949)
- Mobile: attach photos and videos from the library and send them (36a05bff)
- Mobile attachments: review follow-ups (71dd0f74)
- Mobile attachments: say how a stopped upload leaves the queue (eec0ab67)
- Docs: library videos may arrive as H.264, accepted (8a64f156)
- Mobile attachments: end an upload nothing has moved on for a minute (719d88ad)
- Mobile attachments: say iOS holds an upload's body in memory (ad270906)
- Mobile: attach from the camera and from Files (5ef68f12)
- Mobile attachments: say a library video may come as H.264 (79937c92)
- Mobile attachments: camera and files review follow-ups (267a314e)
- Mobile e2e: drive only a booted iOS simulator (4f8e173f)
- Mobile: draw reactions under messages in the timeline (b634eab5)
- Mobile Markdown step 1: name message Markdown values once, share them (5d8ed504)
- Mobile Markdown values: name the margins and emoji size; harden the generator (30b612a5)
- Mobile Markdown step 2: draw a message's inline marks (b5a6c63a)
- Mobile Markdown inline: review follow-ups (64ef7d34)
- Mobile Markdown step 2: draw a message's paragraph with TextKit on iOS (8f39e44a)
- Mobile Markdown native text: review follow-ups (cd91e7c8)
- Mobile Markdown: code blocks stay literal, labels name channels as drawn (2cac8d3f)
- Mobile Markdown step 2: draw a message's paragraph natively on Android (fef6cdcd)
- Mobile Markdown native text: Android review follow-ups (27b46dc5)
- Mobile Markdown native text (Android): boxes stop at the text on a wrap (e2875af8)
- Mobile native build: a hand-run workflow that compiles Android and iOS (6bd8bf7a)
- Mobile native build: drop the temporary pull_request trigger; docs (d4596f82)
- Mobile native build: timeouts, one run per branch, cache written only by main (44c39259)
- Mobile native build: no caches (083b6794)
- Mobile native build: run on the chosen branch, not check it out from main (1948e851)
- Mobile Markdown step 3: draw quotes, lists and code blocks (c98e03f1)
- Mobile Markdown blocks: review follow-ups (379ec266)
- Mobile Markdown spec: list markers stay uncapped (operator) (e1122d37)
- Link previews: share web's rules and values with the phone app (7a615bae)
- Mobile Markdown step 4: link previews under a message (53a62b7a)
- Mobile Markdown spec: step 4 built, the message link its own PR (385049b6)
- Link previews: no x over an image that won't load (d2c55e72)
- Link previews: "(edited)" after the cards, as web's row puts it (fec0091a)
- Link previews: a refetched image retries; note the hidden card's "(edited)" (5fb57c9a)
- Proposal: showing received attachments in the phone app (2a3dc60f)
- Proposal: thumbnails' storage, serving and removal paths; review fixes (af0316c4)
- Attachments: measure images at upload, EXIF orientation applied (ac80f3f6)
- Image sizes: bound the EXIF walk; fill bytes and marker-only codes (318cc00f)
- Attachments: shared values and rules for the phone app (e8e8e472)
- Attachments values: keep why the video sizes are what they are (3ac91b26)
- Phone: images inline, file cards and the expired placeholder (17324d6f)
- Attachments: safe download names, whole files only, never enlarged (ac20e8bf)
- Attachments: thumbnails made by a job, served as their originals (1b414449)
- Web and phone: draw inline images from their thumbnails (5e9c6509)
- Phone video: show the first frame on the tile (6d463b9e)
- Thumbnails: close the decode bound's holes (db39d6bb)
- Phone: a full-screen viewer for images (0ca7178b)
- Phone: videos in the timeline and playing in the viewer (af3e024b)
- Phone: audio files play in the timeline (0b06b398)
- Phone video posters: read frames off the shared queue, at 1024 px (d1e2a3aa)
- Thumbnails: cost RGB JPEGs as the decoder reads them; WebP at 12 (9f1328a7)
- Phone viewer: review fixes, and paging that works on Android (392ce2f1)
- Phone video: clear of the bars, paged from them, load errors retried (9a505823)
- Phone audio: pauses that hold, retries, and the player's edges (35148b84)
- Images: bound avatar, icon and link preview decodes by memory (cc26caa2)
- Phone viewer: the video player's full screen button again (5ce68ad5)
- Phone e2e: the upload flow waits for the photo and the card, not 📎 names (e170954e)
- Thumbnails: a PNG with more chunks than the walk reads is a skip (0ca7f64f)
- Phone viewer: quick swipes, flings, loose double taps (911e1fd0)
- Phone video: only a failure before load asks whether it decodes (f0816b08)
- Phone audio: a moved row keeps playing; the probe is the video's (b959f2b1)
- Images: count the crop's rows, size a GIF from its frame, interlaced GIF at 2 (e57cf575)
- Phone viewer: say full screen turns, and is the background on Android (c8441de1)
- Images: avatars and link previews turn by EXIF; one JPEG header walk (e2533e40)
- Images: the avatar job turns by the header it checked (638e9379)
- Phone files: one address, every picture in the cache sign-out clears (76b31438)
- Phone files: each player marks a file unplayable for its own try (c2f1106a)

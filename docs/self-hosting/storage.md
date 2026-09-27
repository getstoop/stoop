# Storage and retention

## File storage

Uploaded files — avatars, space icons, and message attachments (up to
100 MB each by default, ten per message) — are stored on the local
filesystem under `STOOP_STORAGE_DIR`: `./data` for the bare binary, `/data`
on the `stoop-data` volume in the compose file. Stoop serves them itself
at `/files/{id}` with the same sign-in checks as everything else, so
nothing in that directory needs to be reachable by the web.

Files attached to a message are deleted with it. Uploads that were never
sent and attachments of deleted channels and spaces are removed by the
sweep described under [Upload storage](#upload-storage-the-sweep-and-the-quota).

### Video and audio

Video and audio attachments play in the message, straight from the
uploaded bytes: the server does no transcoding and makes no thumbnails.
What plays is what the viewer's browser can decode. Safe everywhere: MP4
with H.264 video and AAC audio, WebM with VP8/VP9/AV1, MP3, and M4A. An
iPhone's `.mov` plays where the browser supports its codecs. A clip the
browser can't play shows as a download card.

The hard ceiling is 100 MB per file, which is also the largest request
Cloudflare Tunnel's free plan accepts. Long videos are best shared as a
link.

There is no object-storage option: `fs` is the only value `STOOP_STORAGE`
accepts, and the server refuses to start on any other. If you need an
S3-compatible backend, open an issue and say which provider you would
point it at.

## Upload storage: the sweep and the quota

Uploads that are never sent, attachments of deleted channels and spaces,
and replaced avatars and icons are removed by a sweep that runs an hour
after start and then every `STOOP_FILE_SWEEP_INTERVAL` (default `6h`;
`0` turns the timer off). Only files older than `STOOP_FILE_SWEEP_GRACE`
(default `24h`) qualify, so a draft's attachment is never taken from
under it. The admin page's Storage tab shows usage and sets the **Upload storage
limit** on total upload storage (0 = unlimited); past it, uploads are
refused with a message that says how full the server is. Next to it,
**Maximum size per file** caps one attachment, so a single upload cannot
take the whole quota (see [File storage](#file-storage)). **Clean up disk**
runs the sweep on demand.

The same timer also prunes **activity**: mention, reply and DM
items that have been read for longer than `STOOP_ACTIVITY_RETENTION`
(default `720h`, thirty days; `0` keeps them forever) are removed. Unread
ones are never touched.

## Retention: deleting old messages and files

Both settings are off until you set them, on the admin page's Storage
tab, under **Retention**. Leave a field blank to keep things forever.

- **Delete messages after** (1-3650 days): older messages are deleted
  everywhere, direct messages included, with their reactions and files.
- **Delete attachments after** (1-3650 days): older files are deleted
  with their names. The message stays and shows "Expired attachment" and
  the size. Expired files stop counting towards the storage limit.

Pinned messages and their files are kept, and so are avatars, icons and
link preview images. Both run hourly. Saving a shorter period first shows
how many messages and files it would delete now. Deleted data can't be
brought back except from a [backup](backups.md).

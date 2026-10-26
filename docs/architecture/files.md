# Files: uploads, storage, and hygiene

`internal/files` owns everything about a stored byte: the `files` table,
the upload endpoints, the download handler, the sweep that removes what
nothing points at, and the quota that stops a disk filling.

The modules that *display* a file keep only a pointer to it
(`users.avatar_file_id`, `spaces.icon_file_id`, `message_attachments`) and
expose a setter as a port for files to call. Nothing outside this module
knows how bytes are stored.

## Kinds

| Kind | Cap | Treatment |
| ---- | --- | --------- |
| `avatar` | 2 MB in | Stored as sent, then re-encoded to a 256 px PNG by the `normalise_image` job. |
| `space_icon` | 2 MB in | Stored as sent, then re-encoded to a 512 px PNG by the same job. |
| `attachment` | 100 MB, or the operator's lower `max_upload_bytes` | Stored exactly as uploaded; an image's size is read from its header ([Attachment image sizes](#attachment-image-sizes)). |
| `link_preview` | fetched, bounded at 5 MB | Re-encoded like an icon; an animated GIF frame by frame, kept as a GIF. |
| `attachment_thumbnail` | made by the server | An image attachment scaled to fit 1024 px, by the `thumbnail_attachment` job ([Thumbnails](#thumbnails)). |

Kind decides the size cap, the image treatment, and who may download it.

## Two upload paths, for one reason

**Avatars and icons ride inside the Connect request.** They are small, they
are always images, and the request is already authenticated and typed.
`UploadAvatar` and `UploadSpaceIcon` take raw bytes in a proto field. The
request refuses what is cheap to refuse and stores the rest as a *pending*
file for the `normalise_image` job to finish ([Images](#images)).

**Attachments go through `POST /files/upload`**, a multipart form with a
`channel_id` and one file part. Base64 inside a JSON Connect body would
inflate 100 MB by a third and buffer all of it in memory. The multipart
parser keeps 1 MB in RAM and spools the rest to a temp file, so a large
upload does not become a large allocation.

The handler authenticates and takes one of the account's three upload
slots before it reads the body. The operator's per-file cap wraps the
body in a `MaxBytesReader` (plus a little room for the multipart
framing), and an upload that sends nothing for 30 seconds is ended with
`408`, which gives its slot back. The channel and the quota are checked once the body is read:
`Spaces.ChannelSpaceToPostIn` decides membership and the
announcement-channel rule through the port — returning a Connect error that is translated to the right HTTP
status, so there is one implementation of "may you post here".

### Attachments are claimed, not pushed

An upload creates an **unclaimed** file: owned by the caller, in the
channel's space, attached to nothing. `SendMessage.attachment_ids` (at most 10)
claims it. Chat verifies each id through its `FileDirectory` port — kind,
owner, space — and links it in `message_attachments` inside the same
transaction as the message.

`message_attachments.file_id` is `UNIQUE`, which makes "this upload is
already attached to another message" **a database fact rather than a
check-then-act race**. Two sends claiming the same upload cannot both win.

`Message.attachments` is a separate proto field. Attachments are never part
of the Markdown content, so nothing has to parse a message to find out what
it carries.

Uploads that are never claimed — a draft abandoned after picking a file —
are simply left. The sweep collects them.

## Content types are sniffed, never trusted

The client's declared type and the filename extension are both ignored. The
content type is decided from the bytes, and it is what the download handler
later sends.

Go's `http.DetectContentType` is not quite enough, so `sniffContentType`
walks an ISO base media `ftyp` box first. Go's sniffer only claims an
`ftyp` whose brands start with `mp4`, which means an iPhone `.mov` (major
brand `qt  `) comes back as `application/octet-stream`, and an `.m4a`
— whose compatible brands include `mp42` — comes back as `video/mp4`. The
brand walk gets `.mov`, `.m4v` and `.m4a` right. Pre-`ftyp` QuickTime files
(roughly 2005 and earlier) are not recognised; they begin straight at a
`moov` atom, which is too little to distinguish from other formats.

**Nothing is transcoded.** Whether a given clip actually plays is the
browser's business — an HEVC file plays in Safari and not in Firefox — and
the web app falls back to a download card when playback fails. Transcoding
would mean shipping ffmpeg, which is not something a single static binary
does.

## Images

Avatars and icons are decoded (PNG, JPEG, GIF, WebP), centre-cropped,
resized, and re-encoded as PNG at a fixed size, by the `normalise_image`
job ([runtime.md](runtime.md#background-work)), not in the request.

The request keeps the cheap refusals inline, so a person sees them beside
the picker: empty, over 2 MB, not an image by sniffing, dimensions over
the bound, an animated WebP (read from the VP8X flags; the decoder reads
still WebP only, where an animated GIF keeps its first frame). It then stores the original bytes as a **pending** file row and
queues the job in a lane per user or space, so two uploads for one target
apply in the order the server received them, and returns the file id. The job decodes
and re-encodes, replaces the blob under the same key, readies the row
(`image/png`, the new size and hash), points the account or space at it,
deletes the file it replaced, and publishes `member_updated` (chat
publishes `space_updated` from its pointer setter), so clients refetch;
for a bot's avatar the admin who sent it hears it on their own user
topic, since they may share no space with the bot.
Until then everyone sees the old image: the pointer moves only when the
job succeeds, and a failure leaves it where it was. A decode that fails is
permanent: the job discards the pending file and is not retried. Anything
else is retried on the kind's ladder, and the last failed attempt
discards the file too, so no pending file outlives its job. The uploader
is told nothing on a failure; the image simply stays as it was.

The kind runs one at a time across every dispatcher (`MaxInFlight: 1`).
The largest decode the bound allows, a 4096×4096 16-bit PNG, holds about
195 MiB while it runs (128 MiB of pixels and a 64 MiB resampling buffer)
and peaks at 330 MiB of resident memory over repeated jobs, inside the
`jobs` compose service's 512m limit; two at once reached 650 MiB even
under `GOMEMLIMIT`, which the service sets as insurance. A normalise
takes tens of milliseconds for a typical picture and under half a second
for the largest, so a second upload waits that long. Link preview images
are still re-encoded in the request that fetched them (`preview.go`).

Three things fall out of the re-encode:

- **Metadata is stripped.** A person uploading a photo as an avatar does
  not also upload where it was taken.
- **The stored bytes are ours**, so a malformed file that survived
  decoding cannot be served back to someone else's parser.
- **The decode is bounded**: at most 4096×4096 pixels, because a 2 MB PNG
  can declare almost any dimensions and a naive decoder would happily
  allocate for them.

### Attachment image sizes

An attachment is never decoded, but a PNG, JPEG, GIF or WebP has its
width and height read from its header at upload (`image.DecodeConfig`
on the spooled part, which decodes no pixels), so a client can lay the
image out before it loads. They go in `files.width` and `files.height`
and reach the message as `Attachment.width` and `Attachment.height`.

The size is the one a person sees: a phone photo is usually stored
sideways with an EXIF Orientation of 6 or 8, which every display honours
and `DecodeConfig` does not, so orientations 5–8 swap the two. Go has no
EXIF reader; `image_size.go` walks just far enough to find the tag (a
JPEG's APP1 segment, or a WebP's `EXIF` chunk when its VP8X flags say
there is one, then the TIFF block's first IFD), checks every length
against what is there, and holds at most 64 KiB. The walk is bounded
too: a JPEG's stops at the frame header, after 64 segments or 256 KiB,
and a WebP's after 32 chunks or at the end of its RIFF size, so a file
of empty segments costs a few reads. Only JPEG and WebP are read for
orientation; a PNG's `eXIf` chunk is ignored.

Measuring never fails an upload: anything else, a header that won't
read, or a file uploaded before the columns existed has no size, and the
proto says 0×0.

### Thumbnails

A photo is drawn in the timeline at most 420 px wide on web and 312 pt
on a phone, and its original is often several megabytes. So a PNG, JPEG
or still WebP attachment larger than 1024 px on a side gets a smaller
copy, made by the `thumbnail_attachment` job (`thumbnail.go`), which the
upload queues once the file is stored. Never for a GIF, an animated WebP
or an APNG (an `acTL` chunk before the image data), whose still would
stop the animation, and none is kept that would be no smaller than its
original. The message carries it as `Attachment.thumbnail_file_id`, and
the clients draw it inline when it is set; the preview, downloads and
the phone's Share use the original.

The job decodes the original as it reads the blob, averages it down to
at most 2048 px on its longer side while converting (`shrinkBy`, a band
of rows at a time), scales that to fit 1024×1024 with Catmull-Rom, turns
it as its EXIF orientation says (the reader above), and encodes a JPEG,
or a PNG when any of it is transparent. The averaging comes first
because the scaler's buffer grows with the source's height (32 bytes per
destination column per source row: 196 MB straight from a 48 MP photo).
The re-encode drops the metadata, a photo's location included. It is
stored as its own `files` row of kind `attachment_thumbnail`, with
`thumbnail_of` naming the original (`ON DELETE CASCADE`, at most one per
original). It is inserted without the quota check, since the upload it
came from passed it, and `StorageUsage` counts it, as does retention's
preview. The cascade takes only the row, so every path that removes an
original takes the thumbnail's blob too: `DeleteFiles` (a deleted
message), the sweep, and retention, below. A failed decode or a
vanished original is permanent; anything else is retried. Nothing is
announced when it lands: a client sees it the next time it fetches the
message. Images uploaded before this have none.

**The shape comes first:** no side over 20,000 px and nothing longer
than 20 to 1, refused from the size alone. A 200,000,000×1 grey PNG is
under 200 KB, and the decode's buffers follow the long side.

**The bound is on what the job holds, not on pixels**, since that
differs by format: a progressive JPEG's decoder keeps every coefficient
as well as the picture, so no pixel count admits 48 MP baseline photos
without also admitting progressive files that exhaust the container.
`thumbnailCost` reckons it from the header alone, before a pixel is
decoded: `decodeCost` (below) plus the band, the averaged image, the
scaler's buffer and the thumbnail, and the job skips anything over
288 MiB. `decodeCost` counts:

- JPEG: 3 bytes a pixel for YCbCr, as if unsubsampled; 7 for one the
  decoder reads as RGB, which it converts into an RGBA image of its
  own; 1 for grey; 8 for CMYK, which the decoder holds as YCbCr and
  converts; and when progressive, 4 more per component for the
  coefficients. Whether three components are RGB is the decoder's
  rule: no JFIF APP0, and an Adobe APP14 with transform 0 or components
  named R, G, B. An APP14 may come after the first scan, where
  `DecodeConfig` has stopped, so `jpegDecodesAsRGB` walks every marker
  to the end of the image (stepping over scan data) and keeps the
  decoder's state; anything it can't follow counts as RGB. A phone
  photo carries EXIF and no JFIF, but no APP14 and components 1, 2, 3,
  so it is YCbCr.
- PNG: 4 bytes a pixel for 8-bit grey, RGB or RGBA and 8 for 16-bit
  (a `tRNS` chunk, which the header doesn't show, turns grey into
  NRGBA), 1 for paletted, doubled when Adam7-interlaced (each pass is
  decoded into an image of its own first).
- WebP: 12 bytes a pixel: the lossless decoder holds two copies, a
  lossy picture with alpha decodes the alpha losslessly beside its
  planes (7.1 bytes a pixel measured), and the header doesn't always
  say which kind it is.

`TestDecodeCostCoversTheDecoders` decodes every PNG colour type with
and without `tRNS` and interlacing, and each kind of JPEG and WebP, and
checks that what was allocated stays within the reckoning. The bound
admits a baseline YCbCr JPEG up to about 75 MP (4:4:4), an RGB one of
about 32 MP, a 48 MP 8-bit PNG, grey with `tRNS` included, an
interlaced one of about 28 MP, a 24 MP CMYK JPEG, a 16 MP WebP, and
progressive JPEGs of about 16 MP (YCbCr) and 12 MP (RGB). A skipped
image is served as it is.

The kind runs one at a time (`MaxInFlight: 1`), shares one decode slot
per process with `normalise_image` (the server runs both when jobs are
embedded), waits for it no longer than the job's context, gives it back
however the decode ends, and hands freed memory back to the system
before and after each decode (`debug.FreeOSMemory`). Measured in a
container limited to 512m with `GOMEMLIMIT=400MiB`, peak resident:

| Image | Peak | Time |
| ----- | ---- | ---- |
| 12 MP JPEG (4032×3024, 4:2:0) | 95 MiB | 0.3 s |
| 24 MP JPEG (5712×4284, 4:2:0) | 109 MiB | 0.5 s |
| 48 MP JPEG (8064×6048, 4:2:0) | 147 MiB | 0.9 s |
| 48 MP JPEG, 4:4:4 | 217 MiB | 1.3 s |
| 75 MP JPEG, 4:4:4 (the largest admitted) | 293 MiB | 2.0 s |
| 16 MP progressive JPEG, 4:4:4 (the largest admitted) | 291 MiB | 0.7 s |
| 48 MP 8-bit PNG, with alpha | 269 MiB | 1.2 s |
| 48 MP grey PNG with `tRNS` | 265 MiB | 0.5 s |
| 28 MP interlaced RGBA PNG (the largest admitted) | 279 MiB | 0.3 s |
| 32 MP RGB JPEG (the largest admitted) | 279 MiB | 1.3 s |
| 12 MP progressive RGB JPEG (the largest admitted) | 295 MiB | 0.8 s |
| 12 of the largest, one after another | 297 MiB | |

Refused ones cost nothing: a 24 MP progressive JPEG, a 48 MP RGB JPEG,
a 14400² grey PNG with `tRNS` and a 200,000,000×1 PNG each peaked at
16 MiB. These are the job's own numbers: with jobs embedded in the
server ([runtime.md](runtime.md#background-work)) the server's heap
shares the limit. Before the
bound counted them, a 24 MP progressive JPEG peaked at 422 MiB, a 48 MP
one was killed at 512m, and the grey 14400² held 829 MB; without
handing memory back, a run of twelve large ones grew to 463 MiB.

## Serving

`GET|HEAD /files/{id}` is plain HTTP so that `<img>`, `<video>` and the
browser's download machinery work.

A **pending** file answers 404 as if it did not exist, before any
authorisation: nothing serves bytes the job has not finished.

**Authorisation is per kind**, decided in one place (`mayDownload`):

| Kind | Visible to |
| ---- | ---------- |
| `avatar` | Any signed-in user, with any credential. The same line drawn for profiles. |
| `link_preview` | Any signed-in user. The bytes are a public page's own preview image, fetched by the server; gating them per message would mean a membership check per card. |
| `space_icon` | The space's members, and instance admins. Also anyone not signed in who sends a usable invite to that space as `?invite=`, so the invite page can show it. |
| `attachment` (space) | The space's members, and instance admins — as chat's `MayReadSpace` decides, which includes the credential's grant and bounds (`messages.read` in that space). |
| `attachment` (private channel) | The uploader and the channel's people — **no admin bypass** — with a credential that covers `messages.read`. The upload records the channel on the file's row (`private_channel_id`), and a message takes such a file only in that channel, so it can't be posted anywhere else. |
| `attachment` (DM) | The uploader and the DM's participants — **no admin bypass** — with a credential that covers `dms.read`. |
| `attachment_thumbnail` | Whoever may download its original: the handler looks the original up and asks the rule above about it, since a DM's readers are found through `message_attachments`, which holds only the original's id. `410` once the original has expired. |

The invite rule gives away nothing the code doesn't already: `LookupInvite`
answers the same code with the space's name, description and icon id. A
wrong code, a spent one, or a file that isn't that space's icon gets the
same 401 as no code at all.

Both handlers take the session cookie or a bearer credential (a personal
token), through the same `SessionVerifier` port as `/ws`. An upload needs
`messages.post` in the channel's space, or `dms.post` for a direct message,
and chat's membership answer honours the credential's bounds.

Downloads are served **through the app rather than by presigned URL**, so
authorisation stays in one place. A presigned URL is a capability that
outlives the check that issued it, which is the wrong shape for a file
whose visibility follows a membership that can change.

Response headers, and why each is there:

- `Content-Type` **from the row** — never re-sniffed at serve time, so the
  type that was authorised is the type that is sent.
- `X-Content-Type-Options: nosniff`.
- `Content-Disposition: inline` for raster images and playable media;
  `attachment` for everything else — so **SVG never renders on the app
  origin**, which would otherwise be a scripting surface.
- `Cache-Control: private, max-age=31536000, immutable` — a file's bytes
  never change under its id, so this is safe, and it matters on a home
  connection.
- `ETag` (the id) and `Accept-Ranges: bytes`.

**Range requests are supported** — single ranges, 206/416, `If-Range`
against the ETag — through `blob.Store.OpenRange`. This is not a nicety: it
is what lets a `<video>` element seek, and **iOS Safari will not play a
video at all without it.**

## The blob boundary

`internal/blob` is the only package that touches storage.

```go
type Store interface {
    Put(ctx, key string, r io.Reader, size int64, contentType string) error
    Open(ctx, key string) (io.ReadCloser, Stat, error)
    OpenRange(ctx, key string, offset, length int64) (io.ReadCloser, Stat, error)
    Stat(ctx, key string) (Stat, error)
    Walk(ctx, fn func(key string, st Stat) error) error
    Delete(ctx, key string) error
}
```

**Keys are `{kind}/{id}`, both segments `[A-Za-z0-9_-]`, minted by the
server** — never a client filename. The grammar is enforced by a regexp in
`blob`, so **path traversal is impossible by construction** rather than by
a sanitising function somebody has to remember to call. There are no dots
in a key, so `.` and `..` cannot appear at all.

That grammar has a second, useful consequence: the LiveKit key file lives
in the storage directory, and because its name contains a dot, `blob.Walk`
skips it and the sweep cannot touch it.

**`fs` is the only backend.** `STOOP_STORAGE` is validated at
startup, and anything else — `s3` included — is a fatal configuration error
rather than a silent fallback to local disk, which is the failure mode that
loses people's files. The fs backend writes atomically via a temp file and
a rename, so a concurrent `Open` sees either the old blob or the complete
new one, never a partial write.

An object-storage backend, if someone asks for one, would be a second
`blob.Store` selected by that same knob. `app.New` is the only place a
store is constructed, so nothing in `internal/files` would change. None
is built.

`blob` may not import `dbgen`: it is bytes by key, and the metadata that
gives them meaning belongs to the files table.

## Pointer swaps

`users.avatar_file_id` and `spaces.icon_file_id` are `ON DELETE SET NULL`
references. The `normalise_image` job replaces the pointer **first** and
deletes the old row and blob **after** (`files.Avatars` ← auth,
`files.Spaces` ← chat); the upload request itself never moves a pointer.

The ordering matters: if the process dies between the two steps, the result
is an orphaned file — which the sweep collects — rather than a user whose
avatar points at bytes that no longer exist.

## The sweep

A self-hosted disk fills quietly. Things that stop being referenced:

- uploads that were never sent,
- attachments of a deleted message, channel or space,
- a replaced avatar or icon whose delete was interrupted,
- an avatar or icon upload whose job never ran,
- preview images no preview points at,
- a blob whose row insert failed.

`internal/files/sweep.go` is the `sweep_files` job kind
([runtime.md](runtime.md#background-work)), scheduled on
`STOOP_FILE_SWEEP_INTERVAL` (default 6 h; 0 disables the schedule).
The admin page's **Clean now** (`SweepFiles`) enqueues one and returns the
job id; the Diagnostics tab shows the pass. It:

1. Pages the `files` table (500 at a time) for rows older than the grace
   period, less thumbnails whose original is live: nothing else points
   at one, and its original takes it when it goes.
2. Asks the owning modules, through ports, **which of these ids do you
   still point at?** — `Spaces.ReferencedFiles` (chat: attachments, preview
   images, icons) and `Avatars.ReferencedFiles` (auth).
3. Deletes the rest, with their blobs and their thumbnails'.
4. Walks the store (`blob.Store.Walk`) for blobs old enough that no row
   names them.

**A file younger than the grace period is never touched**, a pending one
included; a job whose row the sweep took first finds nothing and is
discarded.
`STOOP_FILE_SWEEP_GRACE` defaults to 24 hours, which is longer than any
draft lives between the upload and the send that claims it. That window is
the entire safety mechanism for the claim model: without it, the sweep and
a slow composer would race.

Note that step 2 is a *question*, not a scan. The module boundary forbids
files from querying chat's tables — and the design that constraint forced
is also the better one: a batched question with a bounded answer, where a
future module that starts holding file pointers only has to implement the
same method.

## Retention

`attachment_retention_days` is an instance setting (0 = forever), read
through `files.Policy`. `internal/files/retention.go` runs hourly and
takes attachments older than the period, in batches of 500, less the
files on pinned messages (asked of chat through `Spaces.PinnedFileIDs`).
For each it deletes the blob first, then the thumbnail's row and blob,
then sets `files.expired_at` and blanks `files.name`; a pinned file
keeps its thumbnail. A thumbnail whose original expired without it is
the sweep's. The blob goes first because a row already marked
expired is never looked at again, so its blob would leak.

The row stays so the message still says a file was there: deleting it
would cascade `message_attachments` away and leave a message that was
only a photo empty. An expired file:

- carries `Attachment.expired` with no name, for the "Expired attachment"
  placeholder;
- answers `410 Gone` on download, after the usual authorisation, so a
  non-member learns nothing;
- can't be claimed by a new message;
- doesn't count towards `StorageUsage`.

Avatars, icons and link preview images are never expired; the sweep
above removes those once nothing points at them.

## The quota

`storage_quota_bytes` is an instance setting (0 = unlimited), read through
the `files.Policy` port. An upload that would pass it is refused with HTTP
**507** / `ResourceExhausted`, and the message carries the numbers ("4.2 GB
of 5.0 GB used") rather than a bare refusal. The admin page shows current
usage.

`max_upload_bytes` caps a single file, bounded above by the built-in
`MaxAttachmentBytes` of 100 MB.

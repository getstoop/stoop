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
| `avatar` | 2 MB in | Decoded and re-encoded to a 256 px PNG. |
| `space_icon` | 2 MB in | Decoded and re-encoded to a 512 px PNG. |
| `attachment` | 100 MB, or the operator's lower `max_upload_bytes` | Stored exactly as uploaded. |
| `link_preview` | fetched, bounded at 5 MB | Re-encoded like an icon. |

Kind decides the size cap, the image treatment, and who may download it.

## Two upload paths, for one reason

**Avatars and icons ride inside the Connect request.** They are small, they
are always images, and the request is already authenticated and typed.
`UploadAvatar` and `UploadSpaceIcon` take raw bytes in a proto field.

**Attachments go through `POST /files/upload`**, a multipart form with a
`channel_id` and one file part. Base64 inside a JSON Connect body would
inflate 100 MB by a third and buffer all of it in memory. The multipart
parser keeps 1 MB in RAM and spools the rest to a temp file, so a large
upload does not become a large allocation.

The handler authorises before it reads: the operator's per-file cap wraps
the body in a `MaxBytesReader` (plus a little slack for the multipart
framing), and `Spaces.ChannelSpaceForMember` decides membership through the
port — returning a Connect error that is translated to the right HTTP
status, so there is one implementation of "may you post here".

### Attachments are claimed, not pushed

An upload creates a **pending** file: owned by the caller, in the channel's
space, attached to nothing. `SendMessage.attachment_ids` (at most 10)
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

Avatars and icons are decoded (PNG, JPEG, GIF, WebP), resized, and
re-encoded as PNG at a fixed size. Three things fall out of that:

- **Metadata is stripped.** A person uploading a photo as an avatar does
  not also upload where it was taken.
- **The stored bytes are ours**, so a malformed file that survived
  decoding cannot be served back to someone else's parser.
- **The decode is bounded**: at most 4096×4096 pixels, because a 2 MB PNG
  can declare almost any dimensions and a naive decoder would happily
  allocate for them.

## Serving

`GET|HEAD /files/{id}` is plain HTTP so that `<img>`, `<video>` and the
browser's download machinery work.

**Authorisation is per kind**, decided in one place (`mayDownload`):

| Kind | Visible to |
| ---- | ---------- |
| `avatar` | Any signed-in user. The same line drawn for profiles. |
| `link_preview` | Any signed-in user. The bytes are a public page's own preview image, fetched by the server; gating them per message would mean a membership check per card. |
| `space_icon` | The space's members, and instance admins. |
| `attachment` (space) | The space's members, and instance admins. |
| `attachment` (DM) | The uploader and the DM's participants — **no admin bypass**. |

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

**Today `fs` is the only backend.** `STOOP_STORAGE` is validated at
startup, and anything else — `s3` included — is a fatal configuration error
rather than a silent fallback to local disk, which is the failure mode that
loses people's files. The fs backend writes atomically via a temp file and
a rename, so a concurrent `Open` sees either the old blob or the complete
new one, never a partial write.

An S3-compatible backend will be a second `blob.Store` selected by that
same knob. `app.New` is the only place a store is constructed, so nothing
in `internal/files` changes when it lands.

`blob` may not import `dbgen`: it is bytes by key, and the metadata that
gives them meaning belongs to the files table.

## Pointer swaps

`users.avatar_file_id` and `spaces.icon_file_id` are `ON DELETE SET NULL`
references. Files replaces the pointer **first** and deletes the old row
and blob **after** (`files.Avatars` ← auth, `files.Spaces` ← chat).

The ordering matters: if the process dies between the two steps, the result
is an orphaned file — which the sweep collects — rather than a user whose
avatar points at bytes that no longer exist.

## The sweep

A self-hosted disk fills quietly. Things that stop being referenced:

- uploads that were never sent,
- attachments of a deleted message, channel or space,
- a replaced avatar or icon whose delete was interrupted,
- preview images no preview points at,
- a blob whose row insert failed.

`internal/files/sweep.go` runs on a timer from startup
(`STOOP_FILE_SWEEP_INTERVAL`, default 6 h; 0 disables the timer) and from
the admin page's **Sweep now**. It:

1. Pages the `files` table (500 at a time) for rows older than the grace
   period.
2. Asks the owning modules, through ports, **which of these ids do you
   still point at?** — `Spaces.ReferencedFiles` (chat: attachments, preview
   images, icons) and `Avatars.ReferencedFiles` (auth).
3. Deletes the rest, with their blobs.
4. Walks the store (`blob.Store.Walk`) for blobs old enough that no row
   names them.

**A file younger than the grace period is never touched.**
`STOOP_FILE_SWEEP_GRACE` defaults to 24 hours, which is longer than any
draft lives between the upload and the send that claims it. That window is
the entire safety mechanism for the claim model: without it, the sweep and
a slow composer would race.

Note that step 2 is a *question*, not a scan. The module boundary forbids
files from querying chat's tables — and the design that constraint forced
is also the better one: a batched question with a bounded answer, where a
future module that starts holding file pointers only has to implement the
same method.

## The quota

`storage_quota_bytes` is an instance setting (0 = unlimited), read through
the `files.Policy` port. An upload that would pass it is refused with HTTP
**507** / `ResourceExhausted`, and the message carries the numbers ("4.2 GB
of 5.0 GB used") rather than a bare refusal. The admin page shows current
usage.

`max_upload_bytes` caps a single file, bounded above by the built-in
`MaxAttachmentBytes` of 100 MB.

Bytes are stored as uploaded, with no re-encoding, so only the sniffed
content type decides how they are served: raster images inline, with a
hover bar to download the original; everything else as a download card.

# Sending attachments from the phone app

Status: draft 2026-10-24; the operator's open questions answered the
same day (Decisions); Split step 1 built (branch mobile-attach-photos).
Design: canvas artboards "8c · Attach sheet" and "8c · Channel,
attaching" (states: uploading, ready, one failed, keyboard down).

## Scope

Pick photos, videos and files in the channel and thread composers, upload
them, and send them with a message. **Sending only.** A received
attachment stays the muted "📎 name" line it is today; showing images
inline and opening files is the next step, its own PR (see Later).

## What exists

- **Server: nothing to change.** `POST /files/upload` (multipart,
  `channel_id` + one `file` part) takes a bearer credential, sniffs the
  type, caps the size, and returns `{id, name, contentType, size}` as an
  unclaimed file. `SendMessage.attachment_ids` (at most 10) claims it.
  Three uploads per account at once; the next answers 429.
  Unsent uploads are swept after 24 h
  ([architecture/files.md](../architecture/files.md)).
- **Web** does the same in `api/files.ts` (`uploadAttachment`, a 3-slot
  queue, the limits) and `routes/Channel/Composer.tsx` (pending items,
  wait for uploads, restore on refusal via `unsent.ts restoreFiles`).
- **Mobile**: the composer already has an inert Attach button (dimmed
  while editing). Sending is send-then-merge, never a pending row.

## Design

1. **Attach** (the + in the pill or the card) opens the app's own sheet,
   drawn like the message menu: **Photo library**, **Camera**, **Files**.
2. Picked items go into a **strip at the top of the card**, uploading as
   they arrive: photos and videos as 64 px thumbnails (videos with their
   length), other files as a chip with name and size. Each has a remove
   ×. Uploading shows a spinner over the item; a failure turns it red
   with the reason ("Too big — 100 MB max", or the server's words) and
   it is removed by hand, as on web. No retry button for now.
3. **Send** waits while anything is uploading (dimmed, labelled so for
   screen readers). Failed items are dropped from the send, as on web.
   A message may be files only, no words.
4. With the keyboard down, the pill shows a paperclip count before the
   draft, so the files aren't forgotten.
5. A refused send puts the files back with the draft, ahead of anything
   added since (web's rule). Leaving the channel or thread drops them.
6. Editing a message: Attach stays dimmed (an edit changes words only).

## Tech

- **Pickers** (new native modules, so one phone rebuild):
  `expo-image-picker` for the library and the camera, and
  `expo-document-picker` for files, at SDK 58's bundled versions,
  checked against the stable-versions rule before installing. The
  library uses the system picker (PHPicker on iOS), which needs no
  photo permission; the camera adds `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription` (video) through the plugin's `app.json`
  config. Multiple selection on, capped at the room left of 10.
- **iPhone photos are HEIC.** The server's sniffer doesn't know HEIC, so
  it would store `application/octet-stream` and web would show a download
  card. The picker is asked for JPEG (it converts on export); videos keep
  `.mov`, which the server already sniffs, and are sent as picked (no
  export preset). Metadata goes as the phone gives it (Decisions).
- **Upload**: `mobile/src/api/files.ts`, RN `fetch` with a `FormData`
  file part `{uri, name, type}`, the bearer header, and
  `fetchWithoutCookies`. A spinner, not a progress bar: RN `fetch` gives
  no upload progress, and a progress bar is a later nicety.
- **Shared code**: move web's pure pieces to `@stoop/core/attachments`:
  the limits (`MAX_ATTACHMENTS`, `MAX_PARALLEL_UPLOADS`, the default
  byte cap), the upload-slot queue, `restoreFiles`, `formatBytes` and the
  inline-image/playable checks (the latter for the Later step). Web
  imports them back; its behaviour is unchanged.
- **The cap** comes from `GetInstanceStatus.max_upload_bytes`, read with
  the screen's other server info, so an oversize file fails before
  uploading; the server enforces it regardless.
- **Composer**: holds a pending list (key, local uri, name, size, type,
  fileId?, error?); `send` gains `attachmentIds`. The channel engine's
  send passes them to `SendMessage`; the answer merges via `sent` as now.
- **Tests**: core unit tests for the moved pieces; a Maestro flow that
  attaches a file from the picker and sees the "📎 name" row arrive
  (picker automation on the simulator is the uncertain part; falls back
  to a seeded photo in the simulator's library).

## Split

1. Core move (web unchanged) + the sheet + photo library + strip + send.
2. Camera and Files.
3. Later, its own proposal: received attachments shown inline (images
   via `/files/{id}` with the bearer header, a viewer, video playback,
   files opened with the system share sheet).

## Decisions (operator, 2026-10-24)

- **Location metadata: sent as the phone gives it.** The person controls
  it on the phone (the system picker's location option where iOS offers
  it, and the Camera's location permission), so the app does no
  stripping or re-encoding of its own. The HEIC-to-JPEG export stays,
  for the format only; to confirm on the device that the export passes
  the metadata through unchanged rather than adding or dropping any.
- **Large files: the upload fails, nothing more.** No smaller video
  export preset, no compression, no resumable or chunked upload. An
  oversize file gets the cap's message before uploading, or the server's
  413 if it slips past; either way the item turns red and is removed by
  hand. Chunked uploads come later as their own work, so nothing here is
  shaped around them or would need undoing for them.
- **Android stays unverified** until there is a test device. It is drawn
  the same, with tokens and no glass, as the rest of the composer.

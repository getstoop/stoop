# Showing received attachments in the phone app

Status: approved 2026-10-25 (the designs, every recommendation, and
server thumbnails added as step 4). Steps 1–7 are built; audio plays
on `expo-video`, which plays audio files without a view, so
`expo-audio` was not added (Open questions → 12).
Follows [mobile-attachments.md](mobile-attachments.md) (sending, #549,
#550), whose Later section names this step.
Design: canvas artboards, all in the "On a server" row after "8c":
"8d · Channel, a photo" (landscape, portrait, size unknown),
"8d · Channel, several photos" (2, 3, 4, 4 with a video, 10),
"8d · Channel, video, audio and files" (audio not started, playing),
"8d · Loading, failed and expired", "8d · Viewer, photo" (iOS and
Android; fitted, pinched in, bars hidden, swiping down to close),
"8d · Viewer, video" (playing, paused, can't play), "8d · Tap on a file"
(at rest, downloading, share sheet) and "8d · Message menu on a photo".

## Scope

Draw a received message's files in the channel and thread timelines the
way web's `Attachments` does: images inline, video as a still that plays
full screen, audio as a player, anything else as a card, an expired file
as a placeholder. A full-screen viewer for images and video. A tap on any
other file hands it to the system. One component, used by channel rows,
the thread screen and (compactly) the long-press menu's card. Two server
changes support it: image sizes at upload and thumbnails.

Out of scope: sending (done), video stills, in-app document preview,
saving to the photo library, and any other client behaviour web doesn't
have today (see Later).

## What exists

- **The message.** `Attachment {file_id, name, content_type, size,
  expired}` (proto/stoop/chat/v1/message.proto). No width, height,
  duration or thumbnail. `content_type` is sniffed from the bytes at
  upload, never the client's word. An expired file keeps its type and
  size and loses its name.
- **The server** (`internal/files`, [files.md](../architecture/files.md)).
  `GET /files/{id}` serves the original bytes with the bearer token,
  `Cache-Control: private, max-age=31536000, immutable`, an ETag and
  single-range `Range` support (AVPlayer refuses to play without it).
  Raster images and playable media come `inline`, everything else
  `attachment`; an expired file answers 410.
  **An attachment upload decodes nothing.** `storeAttachment` reads 512
  bytes to sniff the type and streams the rest to disk. Avatars, space
  icons and link-preview images are decoded and re-encoded (bounded at
  4096×4096), and link previews already carry `image_width` and
  `image_height` in the proto (`StoreLinkPreviewImage` →
  `processImageFit`), so measuring images is something the server
  already does elsewhere. Nothing is transcoded and there is no ffmpeg,
  so there are no video posters.
- **Web** (`web/src/components/Attachments/`):
  - `index.tsx` picks, in this order: expired → playable video →
    playable audio → inline image (PNG, JPEG, GIF, WebP) → card. The
    type checks are already shared (`core/attachments`
    `isInlineImage`, `isPlayableVideo`, `isPlayableAudio`,
    `formatBytes`).
  - `ImageAttachment`: the image at its own size, shrunk to fit
    `min(420px, row)` wide and 320 high (`attachments.css`), on the
    panel with a 1px border and `--radius-md`. A click opens the
    preview. **`MediaCaption`** is not a caption the sender writes:
    it is a bar with the file's name, size and a download button, laid
    over the bottom of an image on hover, always over a video's still,
    and in a row of its own above an audio player.
  - `VideoAttachment`: `<video preload="metadata">` showing its first
    frame, 280 wide and at most 200 high on black, with a round play
    badge; a click plays it in the preview. A decode error turns it
    into the download card (an HEVC `.mov` in a browser that can't
    play it).
  - `AudioAttachment`: the caption row above the browser's own
    `<audio controls>`; an error turns it into the card.
  - `AttachmentCard`: file icon in the accent, name, size; a click
    downloads. `ExpiredAttachment`: a dashed outline, file icon,
    "Expired attachment · 2.4 MB".
  - **Several files** are not grouped: `.attachments` is a wrapping
    flex row with an 8px gap, each file at its own size.
  - `gallery.ts` is **not** a layout rule. It decides what the
    preview steps through: every non-expired image and video in the
    loaded message list, oldest first, across messages
    (`galleryMedia`), so the arrows walk the channel's media.
  - `MediaPreview`: the image or a playing video (autoplay, controls)
    over `--scrim-deep`, shrunk to fit; close top left, Download top
    right, previous/next arrows at the sides; Escape, arrow keys and a
    click on the scrim. Focus goes to Download and returns to the
    opener.
  - **How web copes with no sizes:** it doesn't reserve space. Rows
    are virtualised; when a row is measured again (an image arriving)
    the list keeps the view where it was, or at the bottom when it was
    there (`MessageList` `shouldAdjustScrollPositionOnItemSizeChange`).
    The row still visibly grows when its image lands.
- **Mobile.**
  - A received file is one muted "📎 name" line in `MessageRow.tsx`.
    "(edited)" already moves after files and cards when a message has
    them.
  - `Avatar`, `SpaceIcon` and `LinkPreviews/Card` load `/files/<id>`
    through React Native's `Image` with
    `headers: {Authorization: Bearer …}`. `LinkPreviews/layout.ts`
    turns web's CSS rules plus the server's measured size into a
    fixed size before layout, with unit tests run by web's Vitest.
    Image attachments follow the same pattern.
  - The channel list is an inverted `FlatList` with
    `maintainVisibleContentPosition`. Rows above the first visible one
    can grow without moving the view. A row that is on screen and
    grows still pushes its neighbours.
  - `BODY_INSETS.row` makes the words 312pt wide on a 390pt phone.
    That is the room an attachment gets.
  - Native modules in `package.json` today: no image, video, audio or
    sharing module. `expo-file-system` 58.0.9 is in the build as a
    dependency of `expo`. **`react-native-gesture-handler` 3.4.0,
    `react-native-reanimated` 4.7.1 and `react-native-worklets` 0.13.0
    are compiled into the app (they are in `ios/Podfile.lock`) but not
    declared**: pnpm installed them as expo-router's optional peers,
    and the flat `node_modules` lets autolinking find them. Nothing
    imports them.

## Design

Each place it departs from web says so, and why.

### In the timeline

The row order stays web's: words → files → linked-message cards (none
on the phone yet) → link previews → "(edited)" → "Also sent to" →
reactions → the thread line ("8d · Channel, video, audio and files"
draws all of them).

1. **One image.** Web's rule: its own size, shrunk to fit 312 wide (web:
   `min(420, row)`) and 320 high, never enlarged, on the panel with a
   1px border and an 8pt radius. A 4:3 photo is 312×234; a 3:4 photo is
   240×320. The size is known before layout (Tech → Image sizes), so
   the row never jumps. An image with no known size (anything
   uploaded before the server change) gets a fixed 312×234 box with
   the image fitted inside it on the panel, so it doesn't jump either
   (the "size unknown" state). An absurd shape (a 4000×20 strip) is
   kept at least 44pt on its short side, cropped to fill.
   **Departure:** no name bar over the image. Web shows it on hover,
   and a phone has no hover. The name goes in the screen-reader label
   and the viewer's bottom bar, and download becomes the viewer's
   Share.
2. **Several images and videos in one message.** **Departure:** two or
   more go in a two-column grid of square tiles (152pt each, 8pt gap),
   cropped to fill, in their order, all of them shown (10 is five
   rows). Web wraps each at its own size, and at phone width that
   stacks full-size photos one under another. A grid also needs no
   sizes at all, so it never jumps. A video tile is black with web's
   play badge. Audio, other files and expired files follow the grid,
   in their order.
3. **One video.** Web's frame: 280 wide, black, the round play badge in
   the middle, and the name and size bar always shown over its foot.
   **Departure:** no first frame, at least at first. The server has no
   poster, and a native player per row to fetch one is heavy in a
   scrolling list (Open questions → 10). The box is a fixed 280×158.
   Web shows no duration, so neither does this. A tap opens the
   viewer, playing.
4. **Audio.** Web's layout: the name and size row, then a player of our
   own drawing (round play/pause in the accent, a progress track,
   "0:27 / 1:12"). Nothing plays until tapped. Starting one stops
   any other, and leaving the channel stops it.
5. **Other files.** Web's card (accent file icon, name, size), at least
   44pt tall for the finger. A tap downloads and opens the system share
   sheet (below).
6. **Expired.** Web's dashed placeholder, "Expired attachment · 2.4 MB",
   which does nothing when tapped.

### Loading and failure

- **Loading:** the box at its final size, on the panel, with a faint
  image glyph. No spinner: a timeline of spinners is noise, and web
  shows none.
- **An image that fails** (network, 401, 410 before the message's
  expiry arrives) turns into a card in its place: an image glyph, the
  name, "Couldn't load · tap to retry". **Departure:** web leaves a
  broken image. The phone follows web's own rule for a video that
  can't play, which becomes the card, and adds a retry, since a phone
  loses its network far more often than a desk does.
- A video or audio file the phone can't decode (an HEVC clip on an
  older Android) becomes the plain card, as on web, and its tap shares
  the file so another app can try.

### The viewer

The counterpart of `MediaPreview`, drawn in "8d · Viewer, photo" and
"8d · Viewer, video".

- **Black**, the image fitted to the screen, drawn from the thumbnail
  until the original arrives. **Pinch** to zoom, and a
  **double tap** zooms in on that spot (or back out). While zoomed,
  a drag pans the image.
- **Swipe sideways** to step through media, using web's list: every
  image and video in the loaded channel (or thread), oldest first, not
  only this message's (Open questions → 6). "2 of 4" sits in the
  bottom bar.
- **Swipe down to close:** the image follows the finger and shrinks
  while the black fades. Let go far enough or fast enough and it
  closes; otherwise it springs back.
- **A single tap** hides and shows the bars.
- **Top bar:** Close (iOS: ×; Android: ← as its back), the sender and
  time (they change as you swipe to another message's media), and Share
  (the platform's share glyph). **Departure:** the sender and time are
  new. Web's preview shows neither, but on a phone the viewer covers
  the message it came from.
- **Bottom bar:** the name and size, and "n of m".
- **Video** opens playing, with sound, with the platform's own controls
  (scrub, pause, the time). Swiping away pauses it. A file the phone
  can't play shows the card and "This phone can't play this video.
  Share it to open it elsewhere."
  **Departures (found building it):** the video is drawn in the box
  between the bars, which stay up over it, so they cover none of its
  controls. Any gesture over the native player keeps its controls from
  showing, so there is no swipe down to close on the video itself, and
  while it plays the viewer pages by a swipe on the top or bottom bar
  instead of on the picture. A file that won't load (no network, an
  error status) is told apart from one the phone can't decode by
  asking for its first byte, and says it couldn't load, with Try
  again.
- **Android back** closes it; on iOS the two-finger scrub (the
  accessibility escape) closes it too.

### A tap on a file

The card shows a thin accent progress line along its foot and
"1.1 of 2.4 MB" while the file downloads into the app's cache. Then the
**system share sheet** opens on it: on iOS that is Save to Files, open
in another app, AirDrop, Print and the rest, with a preview header; on
Android it is the share chooser. It is pure system UI, so the artboard
draws it as a labelled placeholder, as the composer artboards draw the
keyboard. A second tap while it downloads does nothing. A failure puts
"Couldn't download" in the card's size slot until the next tap.

### Long press

A long press anywhere on an attachment opens the message menu, as it
does on a link preview. **The menu gains nothing**: Share lives in the
viewer and on the card's tap, so the menu doesn't need a second route
to it ("8d · Message menu on a photo"). The menu's card draws the
files compactly, using the composer strip's look: 64pt thumbnails for
images and videos, name-and-size chips for the rest. A full-size
photo would push the menu off the screen.

## Tech

### 1. Image sizes (the server change)

React Native lays a row out before the image arrives. Without a size
the box has to change once the image lands, which is a visible jump on
a row that is on screen, and with the inverted list it can nudge the
messages under the reader's thumb.

**Options:**

- **A. The server measures images at upload** (recommended). In
  `storeAttachment`, for a sniffed PNG, JPEG, GIF or WebP, read the
  header with Go's `image.DecodeConfig` from the part already on disk
  (`ReadSeeker`, then seek back). That reads only the header and
  decodes no pixels, so it costs microseconds and no memory. Then:
  - new nullable columns `files.width` and `files.height`;
  - `Attachment.width` and `Attachment.height` (`int32`, 0 when
    unknown);
  - `files.Info`, chat's `FileRecord` and `toProtoAttachment` carry
    them.

  **EXIF orientation is part of it.** A phone photo is usually stored
  sideways with an Orientation tag of 6 or 8, which `DecodeConfig`
  ignores, while browsers and both phone image stacks honour it. A
  portrait iPhone JPEG reads as 4032×3024 and must be reported as
  3024×4032. Go's standard library has no EXIF reader. A small one
  that finds APP1 → TIFF → tag 0x0112 is about 60 lines plus table
  tests (Open questions → 2). It only affects JPEG (and WebP, which
  can carry EXIF but rarely does).

  Old messages stay at 0×0 and get the fixed box. A one-off backfill
  job could measure them from their blobs, but isn't needed (Open
  questions → 3). Web could use the numbers to reserve space too (an
  `aspect-ratio` on the image); that is optional and not part of this
  work.
- **B. A fixed box, sized on load.** No server change. Every single
  image starts in a 312×234 box and resizes to its real shape when it
  loads (`onLoad` gives the size). Each image jumps once per mount, and
  portrait photos, which are most phone photos, jump the most.
- **C. A fixed box, never resized.** No server change and no jump, but
  every portrait photo is letterboxed small inside a landscape box
  (175pt wide in a 312pt box). Fine as the fallback for old files, poor
  as the rule.
- **D. Server thumbnails as well.** They don't give the shape before
  layout any sooner than A does, so they are not an alternative to it.
  They save bandwidth, and they are their own step (Tech → Thumbnails).

**Recommendation: A**, with C as the fallback for files that have no
size. It is small, has no new dependency, is easy to test, and is useful
to web. B is the client-only alternative if the operator would rather
not touch the server yet.

The phone's layout lives in `components/Attachments/layout.ts`, built
like `LinkPreviews/layout.ts`: pure and unit-tested. Given the
attachments and `bodyWidth`, it returns each item's box: fitted, grid
tile, fixed fallback, video, audio, card or expired.

### 2. Loading images: memory and caching

- **The problem.** These are originals (until thumbnails, step 4;
  after it the viewer and older images still load originals). A 12 MP photo is 2–5 MB on the
  wire and about 48 MB as a bitmap if decoded at full size. A channel of
  photos in a `FlatList` can exhaust memory unless each is decoded at the
  size it is drawn: 312pt at 3× is 936 px wide, about 2.6 MB.
- **React Native's `Image`.** On iOS it decodes at the view's size. On
  Android (Fresco) it needs `resizeMethod="resize"` to do the same.
  Caching is the platform's: `NSURLCache` on iOS, Fresco's own on
  Android, honouring the immutable header but not under our control.
  On Android an animated GIF does not animate without an extra Fresco
  module.
- **`expo-image`** (recommended; **a new native module, so it needs
  operator approval and a phone rebuild**). SDK 58 bundles `~58.0.15`,
  a stable release from 2026-10-15; npm's `latest` is 58.0.17, but the
  SDK's pin is the one to use. It decodes at the view's size on both
  platforms, keeps a memory and a disk cache keyed by URL (ours include
  the server's origin and the file id, and the file never changes under
  its id), animates GIF and WebP on both, takes `headers` in its
  source, and has a `recyclingKey` for list cells. It can also hand
  back the cached file's path (`getCachePathAsync`), so Share needn't
  download a picture twice.
- **Signing out** of any server clears the image caches (`expo-image`'s
  `clearDiskCache` and `clearMemoryCache`, all servers). That is the
  simple rule: a photo from a private channel shouldn't outlive the
  session on a shared phone.
- **In the viewer** only the shown page decodes at full resolution (so a
  zoom stays sharp), and its neighbours decode at screen size.

### 3. Thumbnails

Added at the operator's request on 2026-10-25, after the design pass.

- **Why.** A timeline tile is at most 312pt wide (936 px at 3×) and a
  grid tile 152pt. The original is 2–8 MB, so a grid of four can be
  20–30 MB on mobile data to draw four squares. A thumbnail of about
  1024 px on its long side is roughly 100–200 KB. `expo-image` already
  saves the phone's *memory*. Thumbnails save the *download*, on web
  as well as the phone.
- **Made by a job, not in the request.** Decoding photos is what the
  `jobs` service exists for: `normalise_image` already runs one decode
  at a time inside its 512m limit (files.md → Images). A new kind,
  `thumbnail_attachment`, does the same: queued when a PNG, JPEG or
  still WebP attachment larger than 1024 px is uploaded, at most one in
  flight. It decodes from the blob as it is read (attachments go up to
  100 MB), averages the image down to at most 2048 px while converting
  a band of rows at a time, scales that to fit 1024×1024 with
  `x/image/draw` (already a dependency), applies the EXIF orientation
  (the reader from step 1) to the small result, and encodes a JPEG (a
  PNG when the image has transparency). The averaging comes first
  because the scaler's buffer grows with the source's height: scaled
  straight from a 48 MP photo it is 196 MB.
- **One decode at a time per process.** `MaxInFlight` caps each kind
  separately, so a thumbnail and an avatar could otherwise decode side
  by side in the same process (the server runs jobs itself unless
  `STOOP_JOBS=external`). Both kinds share one decode slot, waited for
  no longer than the job's context and given back however the decode
  ends. The thumbnail job hands freed memory back to the system before
  and after its decode (`debug.FreeOSMemory`): without it a run of
  large photos fragmented the heap to 463 MiB.
- **A bound on memory, not pixels.** Avatars' `maxImagePixels` (4096²,
  16.7 MP) would skip the 24 and 48 MP photos recent phones take, and
  no pixel bound works for every format: Go's progressive JPEG decoder
  keeps every coefficient, so a 24 MP progressive file held 422 MiB and
  a 48 MP one was killed at 512m, while a 48 MP baseline one holds
  147 MiB. So the job reckons, from the header alone, what the decode
  and the steps after it will hold, and skips anything over 288 MiB.
  The decode is counted per format: JPEG by colour model (RGB at 7
  bytes a pixel, decided by walking every marker as the decoder does,
  since an APP14 after the first scan makes it RGB; CMYK at 8) plus
  the coefficients when progressive; PNG at 4 or 8 bytes a pixel even
  for grey, because a `tRNS` chunk the header doesn't show makes it
  NRGBA, doubled when interlaced; WebP at 12. A test checks the
  reckoning against what each decoder allocates.
  Before any of that, the shape: no side over 20,000 px and nothing
  longer than 20 to 1, since a 200,000,000×1 PNG is a 200 KB file. The
  numbers, measured for 12, 24 and 48 MP JPEGs and the largest of each
  kind admitted, are in files.md → Thumbnails.
- **Skipped** for a GIF, an animated WebP or an APNG (a still would
  stop the animation), an image already within 1024 px, one out of
  shape or over the bound, and one whose thumbnail would be no smaller
  than the original. A skipped image has no thumbnail and is served as
  today.
- **Storage.** The thumbnail is its own `files` row of a new kind,
  `attachment_thumbnail`, with `thumbnail_of` referencing the original
  (`ON DELETE CASCADE`), so deleting the original's row removes it.
  Every path that removes an original has to take the thumbnail's blob
  too, and the doc for each names it:
  - retention (`retention.go`): an expiring original's thumbnail is
    deleted with it, and a pinned original keeps its thumbnail;
  - deleting a message (`DeleteFiles`);
  - the sweep, which keeps a thumbnail while its original exists,
    since neither chat nor auth references it directly.

  It is inserted without the quota check (it is made after the
  upload was already accepted), but `StorageUsage` counts it, so the
  disk figure stays honest, and so does retention's preview of what
  would be freed.
- **Serving.** `mayDownload` authorises a thumbnail as its original:
  look up the original and check that. Copying the original's space or
  channel onto the row isn't enough, because a DM's readers are found
  through `message_attachments`, which holds only the original's id.
  A thumbnail answers 410 once its original has expired. files.md's
  Kinds and Serving tables gain a row.
- **On the message:** `Attachment.thumbnail_file_id`, empty when there
  is none, carried as width and height are: `files.Info` → `GetFiles`
  → `fileDirectory` (`internal/app/adapters.go`) → chat's `FileRecord`
  → `toProtoAttachment`. Clients use it when it is set and the original
  otherwise. No event goes out when the job finishes. A message sent
  before its job is done (a second or so after the upload) carries
  none, and a client already holding it keeps showing the original
  until it fetches the message again, after a reload or reopening the
  channel. That is acceptable: the original is what shows today.
  Images uploaded before this step have none. A backfill job is Later.
- **Who uses it:** the phone's timeline tiles and the menu strip, the
  viewer as the picture to show while the original loads, and web's
  inline image (the preview keeps the original). Downloads and Share
  always use the original.
- **Privacy:** the re-encode drops EXIF, so the thumbnail carries no
  location. The original is unchanged, as today.

### 4. Video

- **`expo-video`** (**new native module: approval and a rebuild**). SDK
  58 bundles `~58.0.11` (stable, 2026-10-15). It wraps AVPlayer and
  ExoPlayer, takes `headers` on its source, and both players request
  ranges, which the server serves. The viewer uses `VideoView` with
  native controls. There is no player in the timeline: the tile is
  drawn, not a player.
- **Posters.** The server can't make one without ffmpeg. The phone
  could, with `expo-video-thumbnails` (`~58.0.2`, another native module).
  It reads the frame over Range requests, a few hundred KB per video,
  more when the file's index sits at its end, as many phone recordings
  do. The alternative is a player per tile, which is too heavy for a
  list. Recommended: the black tile first, a poster as a measured
  follow-up (Open questions → 10).
- **Autoplay:** never in the timeline. In the viewer it starts on open,
  as web's preview does, because the tap on the play badge was the
  request. It plays with sound and stops when swiped away or closed.
- **What plays.** It is the platform's decision, as on web. An H.264
  `.mov` or `.mp4` plays on both platforms. HEVC plays on iPhones and
  only on some Androids. WebM plays on Android, not iOS. A playback
  error shows the card, with Share.

### 5. Audio

- **Inline player with `expo-audio`** (**new native module: approval
  and a rebuild**; SDK 58 bundles `~58.0.9`, stable, 2026-10-13). It
  takes `headers` too. One player at a time, owned by the screen. It
  stops on leaving the channel and doesn't play in the background.
- **The alternative** is to hand audio to the system (the file card's
  share sheet, or Quick Look on iOS, which plays audio), which needs no
  module. It is worth checking whether `expo-video`'s player plays an
  audio-only file without a view. If it does, that saves the module.
  Open questions → 12.

### 6. Files

- **Download:** `expo-file-system`, already in the build (`58.0.9`, as
  `expo`'s dependency). Using it directly means declaring it in
  `package.json`, which needs no rebuild. Its download takes headers.
  It writes into the cache directory under the file's own name, and the
  cache is cleared on sign-out as above. Progress where the API reports
  it, otherwise the card shows "Downloading…".
- **Hand-off:** `expo-sharing` (**new native module: approval and a
  rebuild**; SDK 58 bundles `~58.0.18`, stable, 2026-10-16) opens the
  share sheet on iOS and Android. React Native's built-in `Share` can
  share a file URL on iOS but only text on Android, so it is not
  enough.
- **In-app preview** (iOS Quick Look, an Android "open with" intent) is
  Later. Quick Look needs a native view controller, so a small local
  module like `modules/stoop-rich-text` (no Expo package offers it).
  Android's open-with needs `expo-intent-launcher` and a content URI.
  The share sheet already gets the person to every app that can open
  the file.

### 7. The viewer

- **A full-screen `Modal`** inside the channel and thread screens, as
  the message menu is, not a route. Its list of media is the screen's
  own state (web's `galleryMedia` over the loaded log), and a cold open
  never lands on it. `onRequestClose` handles Android's back. The
  status bar hides while it is open.
- **Paging:** a horizontal `FlatList` with `pagingEnabled`. It is
  built in, and screen readers can already page it. Scrolling is
  switched off while a page is zoomed.
- **Zoom, pan, double tap and swipe down need a gesture library** that
  works the same on both platforms. iOS's `ScrollView` zooms natively,
  but Android's doesn't zoom at all. Recommended:
  `react-native-gesture-handler` and `react-native-reanimated`,
  declared in `package.json` at SDK 58's versions (`~3.3.0` and
  `4.7.1`, with `react-native-worklets` `0.13.0`). They are already
  compiled in, but gesture-handler came in as 3.4.0 (a stable release
  from 2026-10-16) because pnpm picked the newest for expo-router's
  `*` peer. `expo install --check` would flag that, since SDK 58 pins
  `~3.3.0`, and moving to 3.3.x changes native code, so step 5 needs a
  rebuild. The app root gains
  `GestureHandlerRootView`. Open questions → 7.
- **Share** in the viewer: an image from `expo-image`'s cache, a video
  downloaded as a file is. Share is the only action. On iOS the share
  sheet already offers Save Image; "Save to Photos" as a button of its
  own would need `expo-media-library` and a photo-library permission
  (Open questions → 8).
- **Accessibility.** The viewer is modal (`accessibilityViewIsModal`).
  Focus starts on the image, read as "IMG_2041.jpg, image 2 of 4, from
  Theo Kim, 9:31 AM". The page is an adjustable element whose
  increment and decrement step next and previous, so VoiceOver's
  one-finger swipe up and down and TalkBack's equivalents work as well
  as the three-finger page scroll. Close and Share are labelled
  buttons. The bars never hide while a screen reader is on. Pinch zoom
  is left to the system's own zoom.

### 8. Shared values and shared rules

The operator wants styles named once, in web's CSS, and carried over by
the generator.

- **Values.** `attachments.css` writes its numbers inline today. They
  move into markdown.css's `--md-*` block, which link previews already
  share this way (`--md-preview-*`), so `gen-mobile-theme.mjs` needs no
  change and `attachments.css` reads them back with web looking the
  same:
  - `--md-attachments-gap: 8px` and `--md-attachments-margin-top: 6px`
    (`.attachments`);
  - `--md-attachment-image-max-width: 420px` and
    `--md-attachment-image-max-height: 320px` (`.attachment-image`);
  - `--md-attachment-video-width: 280px` and
    `--md-attachment-video-max-height: 200px` (`.attachment-video`);
  - `--md-attachment-media-max-width: 480px` (video and audio frames);
  - `--md-attachment-bar-pad-y: 6px`, `--md-attachment-bar-pad-x: 8px`
    and `--md-attachment-bar-pad-start: 12px` (`.attachment-bar`);
  - `--md-attachment-card-pad-y: 8px` and
    `--md-attachment-card-pad-x: 12px` (`.attachment-card`,
    `.attachment-expired`);
  - `--md-attachment-icon-color: var(--accent)` (the card's icon).

  The radius and text sizes are tokens already (`--radius-md`,
  `--text-ui`, `--text-sm`). The bar's background is a colour mix,
  which the generator can't carry. The phone builds it from `--canvas`
  at 85% in one line, with a comment pointing at the CSS.
  Phone-only values (the grid's two columns and tile gap, the fallback
  box's 4:3, the 44pt minimum, the viewer's bars) stay in the app,
  where nothing on web could drift from them.
- **Rules.** Move to `core/attachments`:
  - `galleryMedia(messages)` (pure; `gallery.ts` keeps its React
    context and imports it back);
  - a new `attachmentKind(attachment)` returning `"expired" | "video" |
    "audio" | "image" | "file"` in `index.tsx`'s order, which web's
    `Attachments` then uses.

  The phone's grid rule is phone-only and lives in `layout.ts`.

### 9. Accessibility in the timeline

There is no alt text in Stoop, so the label is the file's own name.
Phone names are often "IMG_2041.jpg", so the label leads with the kind:

- "Image, IMG_2041.jpg. Opens full screen";
- in a grid, "Image 2 of 4, IMG_2111.jpg";
- "Video, IMG_2042.mov, 18.6 MB. Plays full screen";
- the card: "trail-map.pdf, 2.4 MB. Opens the share sheet";
- "Expired attachment, 2.4 MB".

The audio button says Play or Pause and the name. Each is its own
element, so the row's words stay readable apart (as `MessageRow`
already arranges). A screen reader still can't open the message menu
from a row; that follow-up is unchanged.

### 10. Expired, failed and the sweep

- **Expired** comes on the message (`expired`), and the placeholder is
  drawn from that alone; nothing is fetched. An image cached before it
  expired is not drawn, because the message says expired.
- **Failed** is per mount: the card's tap retries, and a remount
  (scrolling away and back) tries again.
- **The 24-hour unsent sweep** collects unclaimed uploads only. A
  received file is claimed by its message, so it never applies here.

### 11. Tests

- **Unit tests:** `layout.ts` (fit, grid, fallback, extremes) and the
  core moves, under web's Vitest. On the server: the orientation reader
  (all eight orientations, no EXIF, malformed EXIF) and the upload
  storing the size (a portrait JPEG with Orientation 6 reports
  portrait). The thumbnail job: orientation, transparency, the skips,
  the bound, and each removal path taking the thumbnail with it.
- **Maestro:** the seed uploads a landscape and a portrait JPEG (known
  sizes), a PDF and an expired file. Flows assert the labels, open
  the viewer, swipe to the next image, close it, and tap the PDF to
  see the share sheet. One assertion is proved to bite, and there is
  the operator's phone check, as before.

## Split

One PR each, in order. Each ships on its own.

1. **Server: image sizes.** Migration, `DecodeConfig` plus the
   orientation reader at upload, the proto fields, `FileRecord`, tests.
   Nothing on web or the phone changes. (Skipped if the operator picks
   option B.)
2. **Shared values and rules.** The `--md-attachment*` variables used
   by `attachments.css` (web unchanged, checked in the browser),
   `galleryMedia` and `attachmentKind` moved to `core/attachments`, and
   `generated.ts` regenerated.
3. **Phone: images inline, cards and the expired placeholder.**
   - one image fitted, the grid, the loading box and the failed card
     with retry;
   - file cards that download and open the share sheet;
   - video and audio drawn as cards until steps 6 and 7;
   - the menu card's compact strip.

   Dependencies: `expo-image` and `expo-sharing`, plus
   `expo-file-system` declared (one rebuild).
4. **Thumbnails.** The `thumbnail_attachment` job and its file kind,
   the removal paths and serving, the proto field and its route to the
   message, and the phone's tiles and web's inline image using it. Server tests for the job (orientation, transparency, skips, the
   bound), and a memory measurement recorded in files.md.
5. **Phone: the viewer for images.** The modal, paging, zoom, swipe
   down and Share. Declares gesture-handler, reanimated and worklets at
   SDK 58's versions (a rebuild, because gesture-handler moves to
   3.3.x).
6. **Phone: video.** The tile, and playback in the viewer with
   `expo-video` (a rebuild).
7. **Phone: audio.** The inline player with `expo-audio` (a rebuild),
   or the hand-off if `expo-video` can play audio files on its own
   (Open questions → 12).

The operator asked for these to be stacked without a pause between
them, each reviewed by a fresh agent before its pull request.

## Decisions

Made by the operator on 2026-10-25: the canvas designs are approved and
every recommendation below is taken. In short:

1. The server measures images at upload; older images get the fixed
   box.
2. A small EXIF orientation reader of our own.
3. No measuring of old attachments for now.
4. `expo-image`. The new dependencies, all at SDK 58's pins, are
   `expo-image`, `expo-sharing`, `expo-video` and `expo-audio` (the
   last only if `expo-video` can't play audio files), plus
   `expo-file-system`, gesture-handler, reanimated and worklets
   declared.
5. A two-column grid of squares for several photos, all shown.
6. The viewer swipes through the channel's media, as web's does.
7. Gesture-handler and reanimated for the viewer.
8. Share only; no Save to Photos.
9. A tap on a file opens the share sheet.
10. A plain black video tile; no stills.
11. Nothing plays in the timeline; the viewer plays on open, with
    sound.
12. Audio inline, last, checking `expo-video` first.
13. The long-press menu gains nothing.
14. An image that won't load becomes a card with retry.
15. Sign-out clears every cached image.

Added: **server thumbnails** (Tech → Thumbnails), as step 4.

## Open questions

All decided on 2026-10-25 (see Decisions). Kept for the reasoning, and
because the doc refers to them by number.

1. **How does the phone know an image's shape before it loads?**
   - **A. The server measures it at upload** (two numbers on the
     message).
   - **B. A fixed box that resizes when the image arrives:** each
     image jumps once, portrait ones the most.
   - **C. A fixed box that never resizes:** no jump, but portrait
     photos are small and letterboxed.

   **Recommend A, with C for files uploaded before it.** A is the
   only option where rows never move. It is a small server change
   with no new dependency, it reads only the file's header, and web
   can use it later. B is the choice for a phone-only first step if
   the server shouldn't change yet.
2. **For A, reading a photo's rotation:** phone cameras store photos
   sideways plus a "rotate me" tag, and Go's standard library can't
   read that tag. **Recommend a small reader of our own** (about 60
   lines and table tests) over a Go EXIF library: we need one tag, and
   a dependency for it is more to vet than the code.
3. **Measure old attachments too?** A one-off job could read every
   existing image's header from disk. **Recommend not now:** old
   photos get the fixed box (C), which is stable, just less pretty.
   The job is easy to add if old photos turn out to matter.
4. **Image loading: `expo-image` or React Native's `Image`?**
   `expo-image` is a new native module (approval, a rebuild). It
   decodes each photo at the size it is drawn on both platforms,
   caches to disk under our control, animates GIFs on Android, and
   reuses list cells cleanly. React Native's `Image` can be made to
   work: `resizeMethod="resize"` on Android, no GIF animation on
   Android, and caching left to the platform. **Recommend
   `expo-image`:** full-size phone photos in a scrolling list are
   exactly the case it exists for, and the rebuild coincides with
   `expo-sharing`'s.
5. **Several photos in one message: a grid, or web's layout?** Web
   draws each photo at its own size, which at phone width stacks them
   full size, about 330pt each. **Recommend the two-column grid of
   squares, every photo shown** (ten makes five rows). It is compact
   and needs no sizes. Showing all of them, rather than four and
   "+6", keeps web's rule that every file is visible, and the viewer
   reaches them all anyway. "+N" is easy to add later if long sets
   bother people.
6. **What does the viewer swipe through?** Web steps through every
   image and video in the loaded channel or thread. The brief's
   alternative is only the tapped message's media. **Recommend web's
   rule:** it is already written (`galleryMedia`, shared), it matches
   what people see on web, and the top bar's sender and time say
   whose picture is on screen as you cross messages.
7. **Gestures for the viewer.** Zoom on Android, and swipe-down-to-close
   on both, need `react-native-gesture-handler` and
   `react-native-reanimated`. These are already compiled into the app
   by accident: pnpm installed them as an optional companion of
   expo-router, and gesture-handler came in at 3.4.0 rather than SDK
   58's 3.3.x. **Recommend declaring both at SDK 58's versions** (a
   rebuild, in step 5). The alternative, with no new
   declaration: iOS's built-in zoom, no zoom on Android, and
   swipe-down done with the `PanResponder` the sheets already use.
   It works, but the two platforms behave differently.
8. **Save to Photos.** The viewer's Share opens the system sheet, which
   on iOS includes Save Image; Android's chooser usually doesn't.
   A Save button of our own needs `expo-media-library` and a photo
   library permission prompt. **Recommend Share only for now:** one
   button, no permission, and Save can be added on request.
9. **A tap on a PDF or other file: share sheet or in-app preview?**
   **Recommend the share sheet** (`expo-sharing`), which reaches
   Files, every app that opens the type, AirDrop and Print with one
   small module. An in-app preview (Quick Look on iOS) needs a small
   native module of our own, and Android has no built-in equivalent.
   It's the nicer experience for PDFs, so it is listed in Later.
10. **Video stills.** The server can't make one, since there's no video
    tooling in the binary by design. The phone could fetch a frame per
    video with `expo-video-thumbnails` (another native module, a few
    hundred KB of download per clip). **Recommend the plain black tile
    with the play badge first**, the same tile web shows before its
    frame loads. Then decide on stills once there's a feel for how
    often videos are posted.
11. **Video sound and autoplay.** **Recommend:** nothing plays in the
    timeline. In the viewer it plays on open, with sound, since the tap
    was the request (web does the same), and stops when swiped away.
12. **Audio: inline player or hand-off?** Inline (web's behaviour)
    needs `expo-audio`, another native module. A hand-off to the share
    sheet needs nothing new but leaves the app to listen. **Recommend
    inline, as the last step, so it can be cut** if voice notes turn
    out to be rare. First check whether `expo-video` can play
    audio-only files, which would avoid the extra module.
13. **Should the long-press menu gain Share or Save image?**
    **Recommend no:** the viewer and the card's tap already share, and
    the menu stays the same for every message. If people go looking
    for it there, it is one item to add.
14. **An image that won't load.** Web leaves a broken image. **Recommend
    turning it into a card that says it couldn't load and retries on a
    tap**, the way web already handles a video that won't play. Phones
    lose the network often enough that a retry is worth having.
15. **Clearing cached images on sign-out.** **Recommend yes, all of
    them**, on any sign-out. Per-server clearing isn't offered by the
    library, and a refetch is cheap next to a private channel's
    photos staying on a handed-over phone.

## Later

- A backfill job making thumbnails for images uploaded before step 4.
- Video sizes and duration read from the file's `moov` box on the
  server (pure Go, no ffmpeg), for a correctly shaped video tile and a
  duration badge.
- Phone-made video stills (Open questions → 10).
- In-app preview: Quick Look on iOS (a small local module) and "open
  with" on Android (`expo-intent-launcher`).
- Save to Photos (`expo-media-library`).
- Web reserving space with the new sizes (`aspect-ratio` on the
  image), so its rows stop growing too.
- Pausing GIFs when the system's Reduce Motion is on (web doesn't
  yet either).
- Download progress for very large files, and resumable downloads,
  alongside the chunked uploads in mobile-attachments.md's Later.
- A screen-reader action to open the message menu from an attachment,
  with the row's (already a follow-up).
- Android verification on a real device, as for the rest of the app.

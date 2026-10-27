# Stoop for phones

> [!CAUTION]
> **Work in progress. Do not build or install this app.**
>
> It is not a usable Stoop client: it signs in and stops there,
> it talks to a development server over plain HTTP, and it is not
> released, signed for distribution or supported. Use Stoop in the
> browser. The steps below are only for people developing the app
> itself.

The React Native app, built with Expo as a **development build**: a native
app of our own (not Expo Go) that installs from a Mac onto a real iPhone or
Android phone and loads its JavaScript from Metro on that Mac. Everything
builds locally; no Expo cloud services are used.

So far it is the welcome screen, Add a server, which checks a typed
address, and Sign in, by password, a login provider, or a new account
where the server takes them without an invite, with Forgot password
asking the server for a reset link, and joining from an invite link,
pasted or handed over by the web's open-in-app page. A signed-in server opens
on four tabs: Spaces, listing the server's spaces with their mention
badges, unread dots and mutes, each opening its channels (text channels
with what is waiting in each, voice rooms with who is in them), under a
header that opens the server switcher, a sheet listing every server on the phone with its mention
count or a sign-in that has ended, and Add a server; Activity and
Messages, still empty; and You, a stand-in that says who you are, picks
the theme and signs out.
The screens follow the mobile mockups, one at a time.

## Screens and routes

Navigation is [Expo Router](https://docs.expo.dev/router/introduction/):
each file under `src/app` is a route, and `_layout.tsx` files arrange
them into stacks (and later tabs). Route files are a few lines that
import a screen; the screens themselves live in `src/screens`, so
`src/app` stays a map of the app.

- A screen gets IDs from its route and looks the rest up; never pass an
  object through route parameters. A notification or a link can open any
  screen cold, so it must work that way anyway.
- A screen that needs something first (a server, a session) gets a
  redirect in its folder's `_layout.tsx`, not a check in the screen. A
  layout sees only its own path segments (`[id]`), never the `?query`:
  a guard on a query parameter goes in the route file instead
  (`src/app/sign-in/index.tsx`).
- Buttons navigate with `useRouter()` in `onPress`, not by sitting inside
  `<Link asChild>`: the link hands its own props down and drops a
  `Pressable`'s style function, so the button loses its look.
- To land on a server, go to `/`, which opens the first saved server
  (put first by signing in or switching), never `replace` to `/s/<id>`:
  with another server's `/s/<id>` under it, expo-router navigates inside
  that server's stack and the server never changes. The switcher is the
  one exception: it dispatches a plain stack `REPLACE` at the screen
  under its sheet, so the sheet closes onto the new server
  (`src/screens/ServerSwitcher/index.tsx`).
- Typed routes are off for now: Expo generates their types only while
  Metro runs, and `make mobile-typecheck` runs without it.
- A server (`src/app/s/[id]/_layout.tsx`) is a stack with its tabs at
  the bottom, in the `(tabs)` group, so the URLs don't name it. A space's
  channels push inside the Spaces tab, with the tab bar showing. A
  channel (`s/[id]/space/[spaceId]/channel/[channelId]`) pushes over the
  tabs instead, as a conversation does in the system's own apps, leaving
  the bottom of the screen for its composer.
- The composer (`src/screens/Channel/Composer.tsx`) is one control in
  two states: at rest a pill floating over the list, which scrolls under
  it; tapped, a card above the keyboard with the field, Attach, Aa (the
  formatting row) and Send. Losing focus returns it to the pill with the
  draft kept. On iOS 26 the surface is Liquid Glass
  (`expo-glass-effect`); older iOS and Android draw it with the theme's
  panel and border under a light shadow. Dragging the list puts the
  keyboard away (the card follows the keyboard's hide event; tracking
  the finger needs `react-native-keyboard-controller`, a follow-up). A
  message being quoted (Quote in reply, below) is the card's first line
  under any files (below), the reply strip: a small accent reply arrow,
  "Replying to NAME · " and the first words of the message
  (`core/markdown` `plainText`, as the server previews a reply; a file's
  name when it has none), on one line, with a round Cancel reply at its
  right, which drops the quote and keeps the draft; the pill shows the
  same arrow with "Replying to NAME", or the draft, so the quote is seen
  with the keyboard down. The eleven formats are placed for the step
  that gives them work.
- Attach (the + in the pill or the card) puts the keyboard away and
  opens the app's own sheet (`src/screens/Channel/AttachSheet.tsx`),
  drawn as the message menu's is, with Photo library, Camera and Files.
  Each opens its system picker (`src/screens/Channel/pickers.ts`;
  `expo-image-picker` and `expo-document-picker`, native modules, so a
  build on the phone needs `make mobile-ios` again) once the sheet's
  modal has gone, since a picker presented over it would go with it (or
  after a second, should iOS never say so). Photo library is PHPicker on
  iOS, which asks for no permission: several can be picked, up to the
  room left of ten. iPhone photos are HEIC, which the server can't
  sniff, so the picker is asked for its most compatible form and hands
  over a JPEG; that form covers the whole selection, so an HEVC video
  may come as H.264 (accepted, as it plays in every browser), and
  nothing is stripped from either (where a photo was taken goes if the
  phone puts it in). Camera asks for the camera first and, refused, says
  "Stoop doesn't have permission to use the camera." in the card,
  nothing more; the microphone is the system's to ask for as a video
  starts recording. It takes one photo, as a JPEG, or one video, as
  recorded (no export preset). The simulator's camera opens but takes
  nothing, so only the refusal is tested there. Files is the system's
  document picker, several at once (the first that fit are kept, as the
  library's room is), each copied to the app's cache for the upload to
  read; it needs no iCloud entitlement. The card comes back with the
  files along its top (`AttachmentStrip.tsx`): a photo as a 64pt
  thumbnail, a video as a play mark with its length, any other file as a
  chip with its name and size, a spinner over each thumbnail while it
  uploads, and a remove × on each. Each uploads as it is picked
  (`src/api/files.ts`: `POST /files/upload` with the bearer token,
  through the three-slot queue web uses, `core/attachments`), as a
  multipart part React Native's networking streams from disk: the global
  `fetch` is Expo's, which refuses such a part, so this one request is
  an `XMLHttpRequest` with credentials off (`api/fetch.ts`
  `uploadWithoutCookies`, which settles on every ending, a timeout and
  an abort included, so its upload slot always comes back). A file over
  the server's cap (`GetInstanceStatus` `max_upload_bytes`, read as the
  screen opens), or an empty one, fails before uploading; a failure
  turns the item into a red chip with the reason ("Too big — 100 MB
  max", or the server's words), removed by hand, with no retry. Send
  waits, dimmed and labelled "Send, waiting for uploads", while any
  uploads; failed ones are left out, and a message may be files alone.
  With the keyboard down the pill shows a paperclip and the count before
  the draft. A refused send puts the files back with the draft, ahead of
  any picked since (`core/attachments` `restoreFiles`, which web runs
  too); leaving the channel or the thread drops them, stopping any
  upload still going (as removing one does), and a picker answering
  after that is ignored; and while a message is edited they are out of
  sight and Attach is dimmed. A sent file shows in the row as the next
  item says.
- A message's files are drawn under its words, in the channel and the
  thread (`src/components/Attachments`, sized before layout by its
  `layout.ts` from the width and height the server measured, so a row
  never jumps; `docs/proposals/mobile-attachments-inline.md`): one
  image at its own size, shrunk to the words' width and 320 high, on
  the panel; one the server has no size for in a fixed 4:3 box with
  the image fitted inside; one video as web's frame, 280 by 158 on
  black with its round play badge and its name and size in a bar over
  its foot (no still, as the server makes none, and nothing plays in
  the list); two or more images and videos in a grid of square tiles,
  two to a row, all shown, a video's black with the badge, and the
  other files after them; an audio file as web's player, its name and
  size over a player of the app's own (below); any other file as
  web's card; an expired file as web's dashed placeholder, which
  fetches nothing. An image loads from
  `/files` with the session through `expo-image` (a native module, so
  a build on the phone needs `make mobile-ios` again), decoded at the
  size it is drawn and cached on disk, over a faint image glyph until
  it lands; one that won't load becomes a card saying "Couldn't load ·
  tap to retry" (in a grid, the tile says so), and a tap tries again.
  A tap on a card downloads the file into the app's cache, counting
  what has arrived in its size's place over an accent line, and opens
  the system share sheet on it (`src/api/downloads.ts`, with
  `expo-file-system` and `expo-sharing`; the server's file id must be a
  UUID and the name is made safe and short, `api/fileNames.ts`, and the
  file is written beside its place and moved in whole); a failure says "Couldn't
  download" there until the next tap. Signing out forgets every cached
  picture and downloaded file, for every server. Each file is its own
  element for a screen reader, named by its kind and name ("Image 2 of
  4, IMG_2111.jpg", "Video, IMG_2042.mov, 18.6 MB. Plays full
  screen"). A long press on any of them is the row's, and the
  menu's card draws the files small, in the composer strip's look. A
  tap on an image or a video opens it full screen (`src/components/Viewer`, a
  modal over the channel or the thread, as the message menu is): on
  black, shrunk to fit and never enlarged, as web's preview, its
  thumbnail drawn in the same box until the original lands (decoded
  whole only up to 16 MP), with every other picture the screen has
  loaded a swipe sideways away (a pan of its own, not a paging list,
  which on Android never pages under the pictures' gestures),
  oldest first across messages, as web's preview steps through them
  (`core/attachments` `galleryMedia`, videos among them). Pinch zooms, a double tap zooms in on that spot or back out,
  and a drag pans while zoomed; a drag down follows the finger as the
  black fades and closes it once far or fast enough, or springs back.
  A single tap hides and shows the bars: Close (×, or ← on Android,
  whose back closes it too), who sent it and when, and Share at the
  top; its name, size and "2 of 4" at the foot. Share hands the
  original to the system's sheet, from `expo-image`'s cache when it is
  there and otherwise downloaded as a card's file is. For a screen
  reader the picture is one adjustable element ("IMG_2041.jpg, image 2
  of 4, from NAME, 9:31 AM") whose increment and decrement page, and
  the bars stay. A video's page plays it (`expo-video`, a native
  module, so a build on the phone needs `make mobile-ios` again; its
  config plugin is left out, so there is no background playback or
  picture in picture): from `/files` with the session, by Range
  requests, with sound and the platform's own controls, starting as
  its page comes on screen and pausing as it leaves or as the viewer
  closes; a neighbour fetches nothing until it is paged to, and a page
  left behind by more than one releases it. The video is drawn in the
  box between the bars, which stay up over a video's page, so they
  cover none of its controls. Every touch on the video is its
  controls': a gesture over it keeps them from showing, so while it
  plays the pager pages only from swipes on the bars (everything on
  them but Close and Share lets the touch through to the pager's strips
  under them), and there is no drag down to close. For a screen reader
  the page is adjustable as a picture's is ("…, video 5 of 5, …"), and
  activating it plays or pauses. When the player gives up before the
  file has loaded, its first byte is asked for with the session (an
  error after it loaded is the network's, and on Android a file whose
  video tracks the phone says it can't decode is known as it loads):
  one that answers is a file the phone can't play (a WebM on an
  iPhone, HEVC on some Androids), which shows web's card and "This
  phone can't play this video. Share it to open it elsewhere."; the
  card's tap shares it as Share does, and
  for as long as the app runs the page opens that way and the timeline
  draws it as that card, which a tap shares, as web turns a video it
  can't decode into its download card. One that doesn't answer
  (offline, refused, gone) says "Couldn't load this video." over Try
  again, and is tried afresh next time. The gestures are
  `react-native-gesture-handler` and `react-native-reanimated` (native
  modules, so a build on the phone needs `make mobile-ios` again),
  under a `GestureHandlerRootView` at the app's root;
  `babel-preset-expo` adds the worklets plugin on its own.
  An audio file plays in the row (`Attachments/AudioPlayer.tsx`): a
  round Play in the accent, the track and the time, its length at rest
  once it has been played and "0:27 / 1:12" once started; nothing plays
  until Play is tapped, which says "Play NAME" or "Pause NAME" to a
  screen reader, and once it has started a tap or a drag along the
  track, or a screen reader's adjusting, moves it. The screen plays one
  file at a time on one `expo-video` player with no view (no audio
  module of its own: AVPlayer and ExoPlayer play audio files too),
  released when another starts and with the screen
  (`Attachments/audio.ts`, `useAudioPlayback`). It pauses when the
  screen is covered or left, the viewer opens, or the app leaves the
  front: the system pauses a player only when it has a view. It keeps
  `expo-video`'s audio session, so on an iPhone it is heard with the
  silent switch on and stops other apps' sound, as a video does. A file
  the phone can't decode (Ogg on an iPhone) becomes the card, which a
  tap shares, as an unplayable video does; told apart from a failure a
  retry may mend (offline, a session ended, a dropped connection) by
  asking the server for the file's first byte (`fileAnswers`, as the
  viewer's video does); one it can mend says "Couldn't play · tap to retry" in the
  time's place instead. Two known limits: nothing keeps the screen
  awake for a player with no view, so a long file stops when the phone
  locks itself; and `expo-video` leaves the audio session active after
  a pause, so music another app was playing doesn't come back on its
  own (the viewer's video is the same).
- A long press on a message opens its menu
  (`src/screens/Channel/MessageMenu.tsx`): the channel under a scrim, the
  message drawn once more as a card, and a sheet of five quick reactions
  (the first of web's common row, `core/emoji.ts`, one the reader has
  already given filled in) with More reactions, then Reply in thread
  (with the reply count), Quote in reply, Copy text, Copy link, Edit
  message on the reader's own, and Delete message on their own or, where
  they moderate the space, anyone's (`core/permissions`
  `canDeleteAnyMessage`, as web decides it). A tap on the scrim, a swipe
  down or Android's back closes it, as does the message being deleted or
  the channel going while it is open; opening it taps the phone
  (`expo-haptics`). While the keyboard is up a long press first puts it
  away (the list takes that first touch), and a second one opens the
  menu. A screen reader can't open it yet: an accessibility action on
  the row is a follow-up. All eight of its items work. A quick reaction
  toggles itself on the message and closes the sheet, as web does it:
  the held row takes the reader's toggle at once (`core/reactions`
  `toggledReactions`, through the screen reducer's `reacted`, at the
  row's own seq so the event that follows replaces it), `ToggleReaction`
  goes out, and its answer merges like a send's; a refusal puts the
  reactions back. Copy text puts the message's words on the clipboard
  (`expo-clipboard`, a native module, so a build on the phone needs
  `make mobile-ios` again) as the row draws them, a mention as its
  name and a link as its words or address (`core/markdown`
  `plainLines`). More reactions puts web's emoji picker in the sheet's
  place (`src/screens/Channel/EmojiPicker.tsx`, under the same scrim and
  card): a search field over every emoji's name and keywords
  (`core/emoji` `searchEmoji`, the list and the groups shared with web),
  and with nothing typed, what this phone used recently (`src/api/emoji.ts`,
  newest first, sixteen at most, kept in the keychain as the theme is),
  the common row and every group, in a grid of 48pt cells with the
  reader's own filled in (the recent list is read before the picker
  opens, so its grid is drawn final); a tap toggles that reaction as a
  quick one does, remembers it and closes the sheet, and a second tap
  while it is closing does nothing, on the quick row too. The sheet
  rises with the keyboard while the field has it; on Android that
  offset is unverified (the system's Modal may resize for the keyboard
  on its own, and then the sheet would rise twice). Copy link puts the
  message's link on the clipboard (`src/api/shareLinks.ts` over
  `core/shareLinks`, with the path web builds: the address the phone
  was given for the server, then `/s/<space>/c/<channel>?m=<message>`,
  a `/dm/` path for a direct message, and `?t=<root>&m=<reply>` for a
  reply that stays in its thread, so the browser opens the thread on
  it) and says "Couldn't copy the link" over the composer when the
  clipboard refuses. Web puts the instance's public address on its
  links instead, so a server added by its LAN address gives links
  others can't follow yet: keeping that address with the saved server
  is a follow-up. Delete message asks first, in the system's confirm,
  then `DeleteMessage`; the row goes at once (`deleted`, the same way)
  as the server's event makes it, and a root with replies stays as its
  placeholder when that event says so. What the server refuses is said
  in a line over the composer for a few seconds, with its reason. Quote
  in reply makes the message the composer's quote: the sheet closes,
  the row is ringed in the accent on the panel surface (over the
  mention tint when it has one; the ring stays while the reader scrolls
  or puts the keyboard away), and the composer opens on the reply
  strip with the field focused and, once the keyboard is up, the row
  scrolled to the middle of what it leaves (once; a later keyboard
  leaves the list where the reader put it). The screen holds the quote by id, for this
  channel only, and reads the row from the log, so it goes, silently
  and with the draft kept, when the message is deleted or left as a
  placeholder; a second Quote in reply replaces it, and a send or
  Cancel reply clears it. The reply goes out with `reply_to_message_id`
  and lands as the server's row, which says "↳ Replying to NAME: the
  first words" over its byline, as web's row does (the server's
  preview, `core/messagePreview` on the strip; "a deleted message" once
  that is gone). A refused send puts
  the quote back with the draft, unless another was picked meanwhile,
  as web does. Edit message, on the reader's own, puts the composer
  into editing mode the same way: the sheet closes, the row is ringed
  as a quoted one is (labelled "Editing this message"), and the
  composer opens with the draft set aside and the message's words in
  the field, under a strip that says "Editing message" with an accent
  pencil and a round Cancel editing; Send is Save (a check in the same
  accent circle), and Attach is dimmed, since an edit changes words
  only. The screen holds the edit by id as it holds the quote, one of
  the two at a time: an edit begun drops a quote, Quote in reply ends
  an edit, and the message going (deleted, or left as a placeholder)
  ends it silently, the edited words dropped. Cancel editing or Save
  ends it with the set-aside draft back in the field. The field loads
  the message through core's `fromMarkdown`, its mentions as pills and
  its blocks as blocks, and Save writes `toMarkdown` of what it holds.
  Save with the words unchanged (the content as stored, or as the field
  writes it back) ends the edit with nothing sent; with
  none at all it is refused in web's words ("A message can't be empty —
  delete it instead.") under the field, the edit going on; otherwise
  `EditMessage` goes out and its answer merges like a send's, the row
  then marked "(edited)". A refusal keeps the edited words with the
  server's reason under them. The same message edited elsewhere
  meanwhile leaves the field's words alone; saving then replaces it,
  last write wins, as on web. The list draws no reaction chips yet
  (that is the rich row's ticket), so a reaction shows only in the
  sheet's highlight. Reply in thread opens the message's thread once
  the sheet has gone (below), an empty one on a message that has none
  yet. As on web it is only where the reader may start a thread
  (`core/permissions` `canStartThreads`: not in an announcement
  channel) and not on a reply also sent to the channel.
- A root with replies has a line under it, as the server summarises the
  thread (`message.thread`; nothing is counted on the phone): the two
  who replied last, "N replies" in the accent, an "N new" badge while
  the reader has replies unread, and "Last reply" with its time on the
  right (`src/screens/Channel/ThreadLine.tsx`). The line is one button
  ("4 replies, 2 new, open the thread"), and a root deleted while its
  replies live keeps it under its placeholder, as on web. It pushes the
  thread (`s/[id]/space/[spaceId]/channel/[channelId]/thread/[rootId]`,
  `src/screens/Thread`) over the channel: "Thread" with the channel and
  the space under it, the root at the top ruled off once nothing older
  is left to load, "N replies" (or "No replies yet"), and the replies,
  each time with its day and no day lines, as web's thread draws them.
  It opens at the "New" line above the replies the reader hadn't read,
  worked out once from the root's unread count as the thread opens
  (`core/grouping` `firstUnreadReplyId`), and marks the thread read
  (`MarkThreadRead`) while on screen with the app open, again for each
  new reply; the count clears there and on the channel's line, and on
  a ThreadRead from another device. A new reply's event carries only the
  shared half of the summary, so the reader's count moves on by web's
  rule (`core/threadUnread`, which web runs too): a reply by someone
  else adds to a thread the reader is in and hasn't muted. A read wins
  over a page read on the server before it: the thread is marked again
  whenever its count comes back while on screen, and a read that fails
  is asked for again after a moment. After a reconnect's catch-up the
  channel's newest page, and each open thread's with its root, are asked
  for again, for reads and mutes made elsewhere meanwhile. The thread
  has the channel's composer (`inThread`): the pill reads "Reply in
  thread", and the card has "Also send to #channel" over the field, a
  checkbox (the whole line toggles it) that sends the reply to the
  channel's timeline too (`also_send_to_channel`); as on web each send
  clears it and a refusal sets it back. Sending is the channel's,
  `SendMessage` with `thread_root_id`, the answer merged as `sent`. A
  deleted root or an announcement channel takes no replies, and the
  composer's place says so in web's words (`core/threadReplies`); the
  menu there has no Quote in reply or Edit message, and a quote or an
  edit begun goes as the thread closes (web edits inline there; the
  phone can't yet). A send refused as not found with a root or a quote
  named asks for the channel's header before calling the channel gone,
  and with the channel there, a root the server no longer has is the
  thread gone. A long
  press on the root or a reply opens the channel's menu, without Reply
  in thread, as web's thread offers none; Quote in reply and Edit
  message act on the thread's composer (the menu, the quote, the edit
  and the refusal line are `src/screens/Channel/useMessageActions.ts`,
  the layout `ComposerDock.tsx`, both shared with the channel), and
  Copy link gives a reply the thread opened on it, as web's thread
  does. A reply also sent to the channel says so under it in the thread
  ("Also sent to #channel"), and in the channel it has a line over its
  byline, "↳ replied to a thread:" with the root's author and first
  words, as web's row has it, which pushes the thread landing on that
  reply when it is among the newest replies loaded (otherwise the
  thread opens as usual). The bell at the right of the thread's header
  mutes it (Mute thread, then Unmute thread under the slashed bell; on
  iOS a bar button item with the system's `bell` and `bell.slash`, drawn
  as the back button is, Liquid Glass from iOS 26), as
  web's thread panel does: `SetThreadMuted`, awaited with the bell
  dimmed, then the root's summary muted with its count cleared
  (`core/threadUnread` `mutedOverlay`, which web runs too), so a reply
  there counts as nothing new until it is unmuted (replying leaves it
  muted); a refusal leaves it as it was and says so over the composer.
  Another device's mute arrives as ThreadMuted and lands the same way.
  As on web the bell shows once the thread has replies, and under a
  muted channel it shows the thread muted by its channel and does
  nothing (the header follows ChannelMuted for that).
- A message's links get the cards the server fetched for them
  (`link_previews`), under its words and files, in the channel and the
  thread but not on the menu's card, as web's row draws them
  (`src/components/LinkPreviews`, with web's rules in
  `core/linkPreviews` and its values from `link-previews.css` through
  `theme/generated.ts`): the site, the title in the accent and three
  lines of description beside the accent bar, a squarish image as a
  thumbnail beside them and a wide one under them, or an image alone.
  The image is the server's copy from `/files` with the session, as an
  avatar is. A link to a message on this server gets no card, as on web
  (its origins are the address the phone was given and the instance's
  public one, `src/api/instance.ts`). A tap opens the link in the
  browser and a long press is the row's. The author, or whoever
  moderates the space, gets web's × on each card, which asks first and
  takes it off for everyone (`DismissLinkPreview`); the server's update
  for the message redraws the row. An edited message with files or
  cards says "(edited)" after them, as web's row does, rather than
  after its words.
- On iOS the server's tabs are the system tab bar (`NativeTabs`,
  `src/app/s/[id]/(tabs)/_layout.ios.tsx`): Liquid Glass from iOS 26, SF
  Symbols for icons. Android keeps the drawn bar in `(tabs)/_layout.tsx` until
  it has icons of its own. A screen reached by pressing a tab gets none
  of the layout's route params, so everything under a server reads it
  from `CurrentServer`.
- The app tells the system it is light or dark as the theme is
  (`Appearance.setColorScheme`), so what the system draws matches.

## Realtime

While the app is in the foreground it holds the realtime socket
(`docs/architecture/realtime.md`) to every saved server, not only the
one on screen, so the person shows online wherever they are signed in
(`src/realtime/RealtimeProvider.tsx`). Each opens `/ws?client=mobile`
with the session as a bearer token, so the server announces them as
online on mobile while that is all they have open, and web draws a
phone in place of their dot. Going to the background closes every
socket at once; the server's grace period (`STOOP_PRESENCE_GRACE`)
keeps a quick trip to another app from showing them offline. A socket
reopens after a backoff when it drops, and stays shut after the server
says its session has ended (close code 4001) until a new sign-in
leaves another session in the keychain. Who is in each voice room is
kept there (Ready, then VoiceStateChanged); a screen that needs other
events listens with `useServerEvents`. A space's channels screen
reloads, after a moment's quiet, whenever one touches that space, as
when a channel is created, renamed, deleted or read. A channel runs on
the channel log web's timeline runs on (`core/channelLog`,
`docs/architecture/realtime.md` → The channel log on the client): one
log for the channel, every row by id, merged by the `seq` the server
stamps on each change, so a page, an event and a catch-up can arrive in
any order and the higher seq wins. Messages created, edited and deleted
reach it as events (a deletion as a tombstone, which hides the row, or
leaves a placeholder for a root whose thread still has replies), an
event whose seq is not the next one marks a gap, and after a gap or a
reconnect the screen asks `ListChanges` from the position it holds,
page after page while the server has more, instead of fetching what it
holds again; rows below the server's retention floor go unless pinned.
The log holds at most 2,000 rows, and paging older past that would drop
the newest, the edge the screen keeps live, so the screen's history ends
a page short of the cap and says so (web has a pill back to the newest
edge; the screen has none yet).
The header's rules (a rename, the member count, the events that mean the
channel is gone) are `core/channelHeader.ts`, and the screen's state
over both (the header, why the channel can't be shown, the "New" line's
marker) is `core/channelScreen.ts`, a reducer with its tests beside it.
The screens' own part is small: `src/screens/Channel/channelEngine.ts`
makes the requests and dispatches each answer and event to it, one per
channel, shared by the channel screen and a thread screen pushed over
it (`useChannelLog`, which holds it while a screen is mounted and lets
it go with the last), so a reply, an edit or a read lands once for both;
a thread screen opens its view on the thread's newest replies, with the
root fetched when the channel's page doesn't hold it, pages older ones,
and closes the view as it goes. The screens (`src/screens/Channel`,
`src/screens/Thread`) mark read and draw the rows `core/grouping.ts`
groups (day lines, the "New" line, which message continues the one
before). Sending is send-then-merge, as on web: the
composer clears the draft, awaits `SendMessage`, and the answer's row is
dispatched as `sent` and merged by seq like an event's (the socket's
copy usually lands first; either order leaves one row). There are no
pending rows in the model. A refusal puts the draft back ahead of
anything typed since, with the server's words under the field, and
pressing Send again is the retry.

## Themes

The app wears the web app's themes. `src/theme/generated.ts` is written
from `web/src/themes.css`, `web/src/tokens.css`, the theme list in
`web/src/api/theme.ts` (names, tiers, blurbs) and the `--md-*` block at
the top of `web/src/styles/markdown.css` by `make mobile-theme`; never
edit it by hand (`make lint` and CI fail when it is out of date). Screens
read colours through `useTheme()` and sizes from `tokens`, the same names
as the CSS custom properties in camel case (`--text-muted` is
`textMuted`). Message Markdown draws with `markdown`: sizes in px, a
`-scale` as a multiple of the text size, and a colour as the theme key to
look up (`markdown.quoteColor` is `"textMuted"`).

`ThemeProvider`, around the whole app in `src/app/_layout.tsx`,
holds the current theme, Brownstone to start, and sets the status bar to
match; `useThemeName()` reads and changes it. The choice is made on the
Theme screen, from the You tab, and saved in the keychain: one theme for
the phone, whichever server is open, as web keeps it in the browser.
Following the system's light and dark, as web can, is not here yet.

The Stoop mark is `assets/mark.png` (with `@2x` and `@3x`), cut by
`make brand` and tinted with the theme's accent.

## Prerequisites

- Node 22 and pnpm 11. `mobile/` has its own lockfile and is not a pnpm
  workspace with `web/`.
- **iPhone:** Xcode and CocoaPods. On the phone, Developer Mode on
  (Settings → Privacy & Security); in Xcode, the team that signs the app.
- **Android:** Android Studio, which brings the SDK, `adb` and a JDK, with
  `ANDROID_HOME` set (usually `~/Library/Android/sdk`). On the phone, USB
  debugging on.
- The phone and the Mac on the same Wi-Fi, with the dev server running
  (`make dev`, on :8091). Allow the macOS firewall prompt the first time.

## Point it at the server

Type the dev server's address into Add a server, with the scheme, since
the app otherwise adds `https://`: `http://192.168.1.20:8091`. Use the
Mac's LAN address (`ipconfig getifaddr en0`), not `localhost`, which on a
phone is the phone.

The check follows the desktop app's (`docs/architecture/desktop.md` →
`GET /version`): the server must answer as Stoop and be at least
`MIN_SERVER_VERSION` (`src/api/probe.ts`). A dev build reports `dev`,
which always passes.

## Signing for iOS

The committed bundle ID is `org.getstoop.app`. A bundle ID belongs to
the first Apple team that builds it, so until the project's own team
is set up, build under your own ID and team by adding two lines to
`mobile/.env.local` (read by `app.config.js`):

```sh
STOOP_IOS_BUNDLE_ID=org.getstoop.dev
STOOP_APPLE_TEAM_ID=ABCDE12345
```

Re-run `make mobile-prebuild` after changing either. The first build of
a new ID fails with "No profiles for …". Either open
`ios/Stoop.xcworkspace` in Xcode, pick the team under Signing &
Capabilities and let it register the device and ID, or build once from
`mobile/ios` with `xcodebuild -workspace Stoop.xcworkspace -scheme Stoop
-destination id=<phone UDID> -allowProvisioningUpdates`. Then build
again as usual.

## Make targets

From the repo root. Only `make mobile-typecheck` joins one of `make lint`,
`make test` and `make build`: lint runs it, and so does CI.

| Target | What it does |
| --- | --- |
| `make mobile-ios` | Builds onto a connected iPhone and starts Metro |
| `make mobile-android` | The same for a connected Android phone |
| `make mobile-metro` | Starts Metro for a build already on the phone |
| `make mobile-prebuild` | Regenerates `ios/` and `android/` from `app.json` |
| `make mobile-theme` | Regenerates `src/theme/generated.ts` from the web themes |
| `make mobile-typecheck` | `tsc --noEmit` over `mobile/` and the web code it shares |
| `make mobile-sim` | A release build onto the iPhone simulator (`sim="iPhone 16 Pro"` for another) |
| `make mobile-e2e` | The Maestro flows on a throwaway server (below) |

`mobile/ios` and `mobile/android` are generated (Expo's continuous native
generation) and gitignored. Native settings go in `app.json` or a config
plugin, never into those folders by hand.

`modules/stoop-rich-text` is native code of our own: a local Expo module,
for iOS (Swift, TextKit) and Android (Kotlin, a `StaticLayout`), that
draws a message's paragraph (`docs/proposals/mobile-markdown.md` →
Tech) and holds the composer's field
(`docs/architecture/messaging.md` → The phone's field). Expo links it on
its own; a change to its Swift or Kotlin needs a native rebuild, not
only Metro.

CI typechecks the app but does not compile its native code. A workflow
run by hand does: debug builds for Android (Gradle) and the iOS
simulator (`xcodebuild`, unsigned), from a fresh prebuild. Run it on a
branch that changes native code, a module or the Expo SDK:

```sh
gh workflow run mobile-native.yml --ref <branch>
```

or from the Actions tab (Mobile native build → Run workflow, the branch
in "Use workflow from"), and
follow it with `gh run watch`.

After the first install, `make mobile-metro` (or `pnpm start` in
`mobile/`) serves JavaScript to a build already on the phone, with no
native rebuild.

## Tests

The composer field's rules (marks, links, pills, blocks, typing
shortcuts: `modules/stoop-rich-text/ios/Editor` and the Kotlin files of
the same names) have unit tests of their own, a few cases per feature:

```sh
cd mobile/modules/stoop-rich-text && swift test     # iOS, on a Mac, no simulator
cd mobile/android && ./gradlew :stoop-rich-text:testDebugUnitTest   # Android, Robolectric
```

The Android one needs `JAVA_HOME` at a Java 17 and the generated
`android/` folder (`make mobile-prebuild`).

The app's pure logic that needs no React Native (`MessageBody/native.ts`,
`MessageBody/blocks.ts`, `LinkPreviews/layout.ts`,
`Attachments/layout.ts`, `Viewer/items.ts`, `api/fileNames.ts`) has unit tests beside it (`*.test.ts`), run by web's Vitest with web's
own (`make test`, `web/vitest.config.ts`).

The happy paths are [Maestro](https://maestro.dev) flows in `mobile/e2e/`,
one YAML file each, driving the app on the iPhone simulator: add a server,
sign in and see the Spaces tab's badges, open a space and see what is
waiting in each of its channels, read a channel from its "New" line back
to its first message while messages arrive, change and go, write in a
channel and see the message land once, react to a message from its
menu, see its chip under the message and take it back from the chip,
copy its words and delete it, long-press a message and see what its
menu offers as a member and as a moderator, pick a reaction
from the emoji picker and copy a message's link, quote a message in a
reply, cancel it, send it and see the quote go with its message, edit a
message from its menu, cancel an edit and see Save refuse an emptied
one (and keep a mention's token), open a thread from its replies line
and from Reply in thread and read it while a reply arrives, reply in a
thread, also to the channel, and edit, react and delete there, mute a
thread and see a reply in it counted as nothing new, read messages in
Markdown (the marks, a spoiler revealed on a tap, a channel link that
opens the channel, an emoji-only message, a quote with a spoiler in it,
nested and numbered lists, a code block dragged sideways), see link
previews under messages (served by the seed from 127.0.0.1 while it
turns previews on, so the server runs with
`STOOP_UNFURL_ALLOW_PRIVATE`), none for a link to a message on this
server, open the menu from one and remove one, see a message's files (a
landscape and a portrait photo, the two in a grid, a PDF and a file
`scripts/mobile-e2e.sh` marks expired after the seed), open the menu
from a photo, open a photo full screen, page to the next and close
it, play a clip full screen, and share the PDF to the system's sheet, attach a photo
from the library (a JPEG of the flow's own, `e2e/media`, dated 2099 in
its EXIF so the picker's label finds it, added to the simulator's
library by the flow, a copy each run), remove it, pick it
again from the pill, and send it with words and then alone, see the
camera refused (denied as the flow launches the app), and send a PDF
picked through Files from On My iPhone (`e2e/media`, which
`scripts/mobile-e2e.sh` copies there), add a second
server from the switcher and switch back (the same server by
`127.0.0.1`, which the app counts as another), create an account from a
pasted invite link, and
open an invite the way the web's open-in-app page does, then sign in and
join.
They find things by the words on screen and, for text fields, a
`testID`. They run in the order `e2e/config.yaml` lists them: by their
names, in file-name order (Maestro runs a directory in no fixed order
of its own; a new flow goes in that list too). Some lean on it: the message-menu
flow has ada write in chapters, message-actions has dee write there
(ada only deletes in it, and bea only reads), quote-reply has ada
reply there (and delete the reply) and dee post and delete "Going
once", and edit has ada write there over RPC and delete what she wrote,
which the channel flow needs unread for ada with dee's first
notes alone, so the channel flow goes first. The Markdown flow opens
random from a channel link and the attach flow has ada read and write
there, which the space-channels flow needs unread, so they go last.

`make mobile-e2e` runs them as `make e2e` runs the browser suite, on a
throwaway server: a fresh `stoop_mobile_e2e` database, `bin/stoop` on
:8093, and `e2e/seed.mjs` making the accounts, space and invite over RPC
with the browser suite's seed. What it made is handed to each flow as
`${MEMBER}`, `${INVITE_LINK}` and the rest. `make mobile-e2e
flows=mobile/e2e/sign-in.yaml` runs one.

Before the flows, `e2e/setup/autofill-off.yaml` turns off the
simulator's password AutoFill in Settings. Left on, iOS takes Maestro's
fast typing into a new-password field for AutoFill and covers the field
with a strong password, so the typed one never lands. The app keeps its
real password hints; only the test simulator changes.

Once per machine:

1. Maestro and a Java runtime (17 or newer). Install the Maestro CLI from
   its [release page](https://github.com/mobile-dev-inc/maestro/releases)
   into `~/.maestro`, with Java from `brew install openjdk@17`, and put
   both on the path:
   `export PATH="$HOME/.maestro/bin:/opt/homebrew/opt/openjdk@17/bin:$PATH"`.
2. `make build`, for `bin/stoop`, and `make dev-services` for Postgres.
3. `make mobile-sim`: a release build, with its JavaScript inside, so the
   flows need no Metro. Build again after changing the app.

The flows are not in CI yet: that needs a simulator or an emulator on
the runner.

## Plain HTTP to the dev server

The dev server speaks plain HTTP on the LAN. Expo's native template
already allows that in development, so nothing in `app.json` adds it:

- **iOS:** the generated `Info.plist` sets `NSAllowsLocalNetworking`,
  which permits HTTP to local addresses (Metro relies on it too). It is
  in the one `Info.plist` every configuration uses, so a release build
  carries it as well; the release work removes it or accepts it.
- **Android:** cleartext is allowed only in the debug manifest
  (`src/debug/AndroidManifest.xml`); a release build refuses it.

## Code shared with web

The app keeps no copies of web code, with one small exception:
`src/api/errors.ts` repeats web's `errorText`, since it needs
`@connectrpc/connect`, which `core/` may not import
(`scripts/check-core.mjs`). Two folders of web are shared as source, not
packages:

- `@stoop/gen/*` maps to `../web/src/gen/*`, the client generated from
  the protos.
- `@stoop/core/*` maps to `../web/src/core/*`, web's code that needs no
  browser. That covers the Markdown parser, mention tokens, permissions,
  dates, the emoji (`core/emoji.ts`: the common row, the names and
  keywords and the search over them, with the Unicode list in
  `core/emojiData.ts` and the `:shortcodes:` in `core/shortcodes.ts`),
  the paths a message's link carries and the message a pasted link
  names (`core/shareLinks.ts`), which link previews show and how
  (`core/linkPreviews.ts`), a
  message's one-line preview (`core/messagePreview.ts`), badge
  counts, which
  messages run together and where the "New" line goes, the channel log
  web's timeline runs on (`core/channelLog`, which this app's channel
  screen runs on too), a channel's header
  beside it (`core/channelHeader.ts`) and the channel screen's state over
  both (`core/channelScreen.ts`). Its tests run with web's (`make test`).

Both mappings are in `tsconfig.json`; Metro reads them too, and
`metro.config.js` watches both folders. `metro.config.js` also makes every
package resolve from `mobile/node_modules`, so the shared files use this
app's `@bufbuild/protobuf`, never a second copy from `web/node_modules`.

`tsconfig.json` includes all of `web/src/core`, not only what the app
imports yet. `make lint` and CI typecheck the app, so a web change the
app could not compile fails there. `scripts/check-core.mjs` keeps
`core/` importing only itself, the generated client and the protobuf
runtime. Anything that needs the DOM, a store, React or a web package
stays in `web/src/api/`.

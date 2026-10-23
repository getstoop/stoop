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
- The composer (`src/screens/Channel/Composer.tsx`) is one control in two
  states: at rest a pill floating over the list, which scrolls under it;
  tapped, a card above the keyboard with the field, Attach, Aa (the
  formatting row) and Send. Losing focus returns it to the pill with the
  draft kept. On iOS 26 the surface is Liquid Glass (`expo-glass-effect`);
  older iOS and Android draw it with the theme's panel and border under
  a light shadow. Dragging the list puts the keyboard away (the card
  follows the keyboard's hide event; tracking the finger needs
  `react-native-keyboard-controller`, a follow-up). A message being
  quoted (Quote in reply, below) is the card's first line, the reply
  strip: a small accent reply arrow, "Replying to NAME · " and the
  first words of the message (`core/markdown` `plainText`, as the
  server previews a reply; a file's name when it has none), on one
  line, with a round Cancel reply at its right, which drops the quote
  and keeps the draft; the pill shows the same arrow with "Replying to
  NAME", or the draft, so the quote is seen with the keyboard down. Only
  Send does anything yet: Attach and the eleven formats are placed for
  the steps that give them work.
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
  the row is a follow-up. Seven of its items work. A quick reaction
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
  ends it with the set-aside draft back in the field. A plain field
  can't hold the tokens a mention or a channel link is stored as, so
  the field shows each as its `@handle` or `#name` and Save puts the
  tokens back for the handles the original message had as tokens
  (`core/editableText`, with its tests: a mention moved or repeated
  keeps its token, one removed stays removed, a `@name` the original
  had no token for stays words, and where the original had the same
  words both as a token and as text the n-th stays what the n-th was).
  Save with the words unchanged ends the edit with nothing sent; with
  none at all it is refused in web's words ("A message can't be empty —
  delete it instead.") under the field, the edit going on; otherwise
  `EditMessage` goes out and its answer merges like a send's, the row
  then marked "(edited)". A refusal keeps the edited words with the
  server's reason under them. The same message edited elsewhere
  meanwhile leaves the field's words alone; saving then replaces it,
  last write wins, as on web. The list draws no reaction chips yet
  (that is the rich row's ticket), so a reaction shows only in the
  sheet's highlight. Reply in thread is placed and inert: pressing it
  only closes the sheet, until the step that gives it work.
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
The screen's own part is small: `src/screens/Channel/useChannelLog.ts`
makes the requests and dispatches each answer and event to it; the
screen (`src/screens/Channel/index.tsx`) marks read and draws the rows
`core/grouping.ts` groups (day lines, the "New" line, which message
continues the one before). Sending is send-then-merge, as on web: the
composer clears the draft, awaits `SendMessage`, and the answer's row is
dispatched as `sent` and merged by seq like an event's (the socket's
copy usually lands first; either order leaves one row). There are no
pending rows in the model. A refusal puts the draft back ahead of
anything typed since, with the server's words under the field, and
pressing Send again is the retry.

## Themes

The app wears the web app's themes. `src/theme/generated.ts` is written
from `web/src/themes.css`, `web/src/tokens.css` and the theme list in
`web/src/api/theme.ts` (names, tiers, blurbs) by `make mobile-theme`;
never edit it by hand. Screens read colours through `useTheme()` and sizes
from `tokens`, the same names as the CSS custom properties in camel case
(`--text-muted` is `textMuted`).

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

After the first install, `make mobile-metro` (or `pnpm start` in
`mobile/`) serves JavaScript to a build already on the phone, with no
native rebuild.

## Tests

The happy paths are [Maestro](https://maestro.dev) flows in `mobile/e2e/`,
one YAML file each, driving the app on the iPhone simulator: add a server,
sign in and see the Spaces tab's badges, open a space and see what is
waiting in each of its channels, read a channel from its "New" line back
to its first message while messages arrive, change and go, write in a
channel and see the message land once, react to a message from its
menu, copy its words and delete it, long-press a message and see
what its menu offers as a member and as a moderator, pick a reaction
from the emoji picker and copy a message's link, quote a message in a
reply, cancel it, send it and see the quote go with its message, edit a
message from its menu, cancel an edit and see Save refuse an emptied
one (and keep a mention's token), add a second
server from the switcher and switch back (the same server by
`127.0.0.1`, which the app counts as another), create an account from a
pasted invite link, and
open an invite the way the web's open-in-app page does, then sign in and
join.
They find things by the words on screen and, for text fields, a
`testID`. They run in the order `e2e/config.yaml` lists them, by file
name (Maestro runs a directory in no fixed order of its own, and a new
flow goes in that list too), and some lean on it: the message-menu
flow has ada write in chapters, message-actions has dee write there
(ada only deletes in it, and bea only reads), quote-reply has ada
reply there (and delete the reply) and dee post and delete "Going
once", and edit has ada write there over RPC and delete what she wrote,
which the channel flow needs unread for ada with dee's first
notes alone, so the channel flow goes first.

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
  the paths a message's link carries (`core/shareLinks.ts`), a
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

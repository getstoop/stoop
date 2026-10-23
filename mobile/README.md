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
  `react-native-keyboard-controller`, a follow-up). Only Send does
  anything yet: Attach and the eleven formats are placed for the steps
  that give them work.
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
channel and see the message land once, add a second server from the
switcher and switch back (the same server by `127.0.0.1`, which the app
counts as another), create an account from a pasted invite link, and
open an invite the way the web's open-in-app page does, then sign in and
join.
They find things by the words on screen and, for text fields, a
`testID`.

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
  dates, badge counts, which messages run together and where the "New"
  line goes, the channel log web's timeline runs on (`core/channelLog`,
  which this app's channel screen runs on too), a channel's header
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
